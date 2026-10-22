import { isChildSessionMeta, isClaudeMainTaskCompletion } from "./core";

export type SessionStatus = "running" | "completed" | "failed" | "unknown";
export interface SessionActivity {
  key: string;
  provider: "codex" | "claude";
  sessionId: string;
  turnId: string;
  cwd: string;
  title: string;
  status: SessionStatus;
  startedAt: number;
  updatedAt: number;
  /** Local observation order, separate from historical/remote event time. */
  observedAt?: number;
  /** Baseline history must never create new unread results. */
  live: boolean;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
function contentText(message: unknown): string {
  const content = record(message).content;
  return typeof content === "string" ? content : Array.isArray(content)
    ? content.filter((item) => record(item).type === "text").map((item) => string(record(item).text)).join(" ") : "";
}

/** Tracks turns, rather than treating every assistant/tool message as a completion. */
export class SessionActivityTracker {
  private sessionId = "";
  private cwd = "";
  private child = false;
  private current: SessionActivity | undefined;
  private turnError = false;
  private contextTurnId = "";
  private observedAt = 0;

  public constructor(
    private readonly provider: SessionActivity["provider"],
    private readonly source: string,
    private readonly emit: (activity: SessionActivity, remove?: boolean) => void,
  ) {}

  public reset(): void {
    if (this.current) this.emit({ ...this.current, status: "unknown", observedAt: Date.now() });
    this.sessionId = "";
    this.cwd = "";
    this.child = false;
    this.current = undefined;
    this.turnError = false;
    this.contextTurnId = "";
  }

  public consume(input: Record<string, unknown>, live: boolean, now = Date.now()): void {
    this.observedAt = now;
    const payload = record(input.payload);
    if (this.provider === "codex" && input.type === "session_meta") {
      this.sessionId = string(payload.id) || string(payload.session_id) || this.sessionId;
      this.cwd = string(payload.cwd) || this.cwd;
      this.classifyChild(isChildSessionMeta(payload));
      return;
    }
    if (this.provider === "claude") {
      this.sessionId = string(input.sessionId) || this.sessionId;
      this.cwd = string(input.cwd) || this.cwd;
      this.classifyChild(input.isSidechain === true || Boolean(input.agentId || input.agent_id));
    }
    if (this.child) return;
    const parsedTime = Date.parse(string(input.timestamp));
    // Live observations use this host's clock, including for remote sessions.
    const at = live || !Number.isFinite(parsedTime) ? now : Math.min(parsedTime, now);
    if (this.provider === "codex") {
      if (input.type === "turn_context") {
        this.cwd = string(payload.cwd) || this.cwd;
        this.contextTurnId = string(payload.turn_id) || this.contextTurnId;
        // Context alone is not proof that a task is still running.
        return;
      }
      if (input.type === "response_item" && this.current?.status === "running") {
        this.update("running", at, live);
        return;
      }
      if (input.type !== "event_msg") return;
      const type = string(payload.type);
      const turnId = string(payload.turn_id) || this.contextTurnId || this.current?.turnId || "";
      if (!turnId) return;
      if (type === "task_started") {
        this.contextTurnId = turnId;
        this.begin(turnId, at, live);
      }
      if (type === "user_message") {
        if (!this.current || this.current.turnId !== turnId) this.begin(turnId, at, live);
        if (this.current) this.current.title = string(payload.message).replace(/\s+/g, " ").slice(0, 100);
      }
      if (type === "task_complete") {
        if (!this.current || this.current.turnId !== turnId) this.begin(turnId, at, live);
        this.update(this.turnError ? "failed" : "completed", at, live);
      } else if (type === "turn_aborted" || type === "task_aborted") {
        this.update("unknown", at, live);
      } else if (type === "error") {
        if (this.current?.status === "running") {
          this.turnError = true;
          this.update("running", at, live);
        }
      } else if (this.current && ["task_started", "user_message", "agent_message", "token_count"].includes(type)) {
        this.update(this.current.status, at, live);
      }
      return;
    }

    const content = record(input.message).content;
    const toolResult = Array.isArray(content) && content.some((item) => record(item).type === "tool_result");
    const title = contentText(input.message).replace(/\s+/g, " ").slice(0, 100);
    const stopReason = string(record(input.message).stop_reason);
    if ((input.type === "system" && input.subtype === "api_error")
      || (input.type === "assistant" && input.isApiErrorMessage === true)
      || (input.type === "user" && /^\[Request interrupted by user(?: for tool use)?\]/.test(title))
      || (input.type === "assistant" && ["max_tokens", "stop_sequence", "refusal"].includes(stopReason))) {
      // A disconnected/retrying or interrupted turn is not an active response
      // or a successful completion. Real subsequent activity can resume it.
      this.update("unknown", at, live);
      return;
    }
    if (input.type === "user" && !toolResult) {
      // Ignore bookkeeping records with no human prompt.
      if (!title) return;
      this.begin(string(input.uuid) || string(input.timestamp) || String(at), at, live);
      if (this.current) this.current.title = title;
      this.update("running", at, live);
    } else if (input.type === "assistant") {
      if (!this.current) this.begin(string(input.uuid) || string(input.timestamp) || String(at), at, live);
      this.update(isClaudeMainTaskCompletion(input) ? "completed" : "running", at, live);
    } else if (toolResult && this.current?.status === "running") {
      this.update("running", at, live);
    } else if (input.type === "progress" && this.current?.status === "running") {
      this.update("running", at, live);
    }
  }

  public flushBaseline(now = Date.now()): void {
    if (!this.current) return;
    // Publish only the final replayed state, preserving saved unread results
    // rather than overwriting them with every earlier turn in the file.
    this.emit({ ...this.current, status: this.current.status === "running" ? "unknown" : this.current.status,
      live: false, observedAt: now });
  }

  private classifyChild(child: boolean): void {
    this.child ||= child;
    if (this.child && this.current) {
      this.emit(this.current, true);
      this.current = undefined;
    }
  }
  private begin(turnId: string, at: number, live: boolean): void {
    if (this.current?.turnId === turnId) return;
    this.turnError = false;
    this.current = {
      key: `${this.provider}:${this.source}:${this.sessionId || this.source}`,
      provider: this.provider, sessionId: this.sessionId, turnId, cwd: this.cwd,
      title: "", status: "running", startedAt: at, updatedAt: at, observedAt: this.observedAt, live,
    };
  }
  private update(status: SessionStatus, at: number, live: boolean): void {
    if (!this.current) return;
    this.current = { ...this.current, cwd: this.cwd, status, updatedAt: at, observedAt: this.observedAt, live };
    if (live) this.emit({ ...this.current });
  }
}
