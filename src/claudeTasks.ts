function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function contentText(value: unknown): string {
  return typeof value === "string" ? value : Array.isArray(value)
    ? value.map((item) => text(object(item).text)).join("\n") : "";
}
const terminal = new Set(["completed", "failed", "killed", "stopped", "cancelled", "canceled"]);

/** An end_turn can yield to background work without finishing the user's task. */
export class ClaudeTasks {
  private readonly calls = new Map<string, { name: string; taskId: string }>();
  private readonly queries = new Map<string, { taskId: string; stop: boolean }>();

  public get hasPending(): boolean { return this.calls.size > 0; }
  public reset(): void { this.calls.clear(); this.queries.clear(); }

  public consume(input: Record<string, unknown>): { notification: boolean; changed: boolean } {
    const content = object(input.message).content;
    const attachment = object(input.attachment);
    const notice = input.type === "user" ? contentText(content)
      : input.type === "attachment" && attachment.type === "queued_command"
        && (attachment.commandMode === "task-notification" || object(attachment.origin).kind === "task-notification")
        ? contentText(attachment.prompt) : "";
    if (/^\s*<task-notification(?:\s|>)/i.test(notice)) {
      let changed = false;
      for (const match of notice.matchAll(/<task-notification(?:\s[^>]*)?>([\s\S]*?)<\/task-notification>/gi)) {
        const field = (name: string): string => new RegExp(`<${name}>\\s*([^<]+?)\\s*</${name}>`, "i").exec(match[1])?.[1] ?? "";
        if (!terminal.has(field("status").toLowerCase())) continue;
        const taskId = field("task-id"), toolId = field("tool-use-id");
        for (const [id, task] of this.calls) {
          if ((toolId && toolId === id && (!taskId || !task.taskId || taskId === task.taskId))
            || (taskId && taskId === task.taskId)) {
            this.calls.delete(id);
            changed = true;
          }
        }
      }
      return { notification: true, changed };
    }
    if (!Array.isArray(content)) return { notification: false, changed: false };
    for (const value of content) {
      const block = object(value), args = object(block.input), id = text(block.id);
      if (input.type === "assistant" && block.type === "tool_use" && id
        && ["TaskOutput", "TaskStop", "KillShell"].includes(text(block.name))) {
        this.queries.set(id, { taskId: text(args.task_id) || text(args.shell_id), stop: block.name !== "TaskOutput" });
      }
      if (input.type === "assistant" && block.type === "tool_use" && id
        && ["Agent", "Task", "Bash"].includes(text(block.name))
        && (args.run_in_background === true || args.run_in_background === "true")) {
        this.calls.set(id, { name: text(block.name), taskId: "" });
      } else if (input.type === "user" && block.type === "tool_result") {
        const callId = text(block.tool_use_id), call = this.calls.get(callId);
        const result = object(input.toolUseResult);
        const query = this.queries.get(callId);
        if (query) {
          this.queries.delete(callId);
          const status = text(object(result.task).status) || text(result.status)
            || /<status>\s*([^<]+)\s*<\/status>/i.exec(contentText(block.content))?.[1] || "";
          if (block.is_error !== true && (query.stop || terminal.has(status.trim().toLowerCase()))) {
            for (const [key, pending] of this.calls) if (pending.taskId === query.taskId) this.calls.delete(key);
          }
          continue;
        }
        const taskId = text(result.backgroundTaskId) || (result.isAsync === true || result.status === "async_launched"
          ? text(result.agentId) || text(result.taskId) : "");
        // Bash can be moved to the background automatically after its timeout,
        // even when the original tool call omitted run_in_background.
        if (taskId && callId && block.is_error !== true && !terminal.has(text(result.status))) {
          this.calls.set(callId, { name: call?.name ?? "", taskId });
        } else if (call) {
          // Older transcripts omit structured toolUseResult; accept only the
          // provider's launch prefix on the matching background tool result.
          const output = contentText(block.content);
          const fallback = /^(?:Async agent launched successfully\.[\s\S]*?\bagentId:\s*|Command running in background with ID:\s*)([\w-]+)/i.exec(output)?.[1];
          if (fallback && block.is_error !== true) call.taskId = fallback;
          else this.calls.delete(callId); // Synchronous result or launch failure.
        }
      }
    }
    return { notification: false, changed: false };
  }
}
