export interface QuestionAttention {
  requestIds: string[];
  count: number;
  message: string;
  askedAt: number;
}

interface PendingQuestion {
  asynchronous: boolean;
  questions: Map<string, string>;
  askedAt: number;
  turnId: string;
  exchangeId: string;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function parse(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return object(value);
  try { return object(JSON.parse(value)); } catch { return {}; }
}

/** Track actual tool requests/replies, independently from whether a turn is running. */
export class SessionQuestions {
  private readonly pending = new Map<string, PendingQuestion>();

  public get attention(): QuestionAttention | undefined {
    const entries = [...this.pending.entries()];
    if (!entries.length) return undefined;
    return { requestIds: entries.map(([id]) => id),
      count: entries.reduce((count, [, item]) => count + item.questions.size, 0),
      message: entries[0][1].questions.values().next().value ?? "有问题等待你的回答",
      askedAt: entries[0][1].askedAt };
  }

  public reset(): void { this.pending.clear(); }
  public finishTurn(): void {
    for (const [id, item] of this.pending) if (!item.asynchronous) this.pending.delete(id);
  }

  public consumeCodex(payload: Record<string, unknown>, at: number, contextTurnId = ""): void {
    const metadata = { ...parse(payload.internal_chat_message_metadata_passthrough), ...parse(payload.metadata) };
    const turnId = text(metadata.working_turn_id) || text(metadata.turn_id) || text(payload.turn_id) || contextTurnId;
    const exchangeId = text(metadata.turn_exchange_id);
    const name = text(payload.name).split(".").at(-1);
    const id = text(payload.call_id);
    if (payload.type === "function_call" && ["request_user_input", "request_user_input_async"].includes(name ?? "")) {
      this.add(id, parse(payload.arguments).questions, name === "request_user_input_async", at, turnId, exchangeId);
    } else if (payload.type === "function_call_output" && this.pending.has(id)) {
      const result = parse(payload.output);
      // Async acceptance only creates the question UI; the answer arrives in a
      // later user message, potentially after the requesting turn has finished.
      if (!this.pending.get(id)!.asynchronous || result.accepted !== true) this.pending.delete(id);
    } else if (payload.type === "message" && payload.role === "user") {
      const message = this.messageText(payload);
      this.consumeReplyText(message);
      // The native question UI drops the previous human turn's questionnaire
      // when a new human prompt supersedes it, even without a numbered reply.
      // Automatic turns, steering, system messages and replies are not that signal.
      if (!message.includes("<send_user_message_question_reply>") && metadata.is_user_system_message !== true
        && metadata.codex_optimistic_steering_user !== true && payload.isMeta !== true
        && (message.trim() || (Array.isArray(payload.content) && payload.content.some((value) =>
          ["input_image", "image", "input_file", "file"].includes(text(object(value).type)))))) {
        for (const [requestId, question] of this.pending) {
          const sameTurn = turnId && question.turnId === turnId;
          const sameExchange = exchangeId && question.exchangeId === exchangeId;
          const differentTurn = turnId && question.turnId && question.turnId !== turnId;
          const differentExchange = exchangeId && question.exchangeId && question.exchangeId !== exchangeId;
          if (!sameTurn && !sameExchange && (differentTurn || differentExchange)) this.pending.delete(requestId);
        }
      }
    }
  }

  public consumeClaude(input: Record<string, unknown>, at: number): void {
    const content = object(input.message).content;
    if (!Array.isArray(content)) return;
    for (const value of content) {
      const block = object(value);
      if (input.type === "assistant" && block.type === "tool_use" && block.name === "AskUserQuestion") {
        this.add(text(block.id), object(block.input).questions, false, at);
      } else if (input.type === "user" && block.type === "tool_result") {
        this.pending.delete(text(block.tool_use_id));
      }
    }
  }

  public consumeReplyText(value: string): void {
    for (const match of value.matchAll(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/g)) {
      let replies: unknown;
      try { replies = JSON.parse(match[1]); } catch { continue; }
      if (!Array.isArray(replies)) continue;
      for (const reply of replies) {
        let identity = object(reply).questionItemId;
        if (typeof identity === "string") {
          try { identity = JSON.parse(identity); } catch { continue; }
        }
        if (!Array.isArray(identity) || identity[0] !== "request_user_input_async") continue;
        const id = text(identity[1]);
        const item = this.pending.get(id);
        if (!item?.asynchronous) continue;
        item.questions.delete(String(identity[2]));
        if (!item.questions.size) this.pending.delete(id);
      }
    }
  }

  private messageText(message: Record<string, unknown>): string {
    if (typeof message.content === "string") return message.content;
    return Array.isArray(message.content) ? message.content.map((item) => text(object(item).text)).join("\n") : "";
  }

  private add(id: string, values: unknown, asynchronous: boolean, at: number, turnId = "", exchangeId = ""): void {
    if (!id || !Array.isArray(values) || !values.length || this.pending.has(id)) return;
    const questions = new Map(values.map((value, index) => {
      const item = object(value);
      return [String(index), (text(item.question) || text(item.title) || "有问题等待你的回答").replace(/\s+/g, " ").slice(0, 300)];
    }));
    this.pending.set(id, { asynchronous, questions, askedAt: at, turnId, exchangeId });
  }
}
