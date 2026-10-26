import assert from "node:assert/strict";
import test from "node:test";
import { SessionActivity, SessionActivityTracker } from "../sessionActivity";
import { applyActivity, StoredSession } from "../floatingState";

const start = 1_800_000_000_000;
const assistant = (content: unknown[] = [], stop_reason = "end_turn") => ({ type: "assistant", message: { content, stop_reason } });
const launch = (id: string, name = "Agent", run_in_background: unknown = true) => assistant([
  { type: "tool_use", id, name, input: { run_in_background } },
], "tool_use");
const result = (id: string, toolUseResult: unknown, is_error = false, content: unknown = "launched") => ({ type: "user",
  message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content }] }, toolUseResult });
const notification = (id: string, status = "completed", toolId = "") => `<task-notification><task-id>${id}</task-id><status>${status}</status>${toolId ? `<tool-use-id>${toolId}</tool-use-id>` : ""}</task-notification>`;
function fixture() {
  const updates: SessionActivity[] = [];
  let stored: StoredSession | undefined;
  const tracker = new SessionActivityTracker("claude", "source", (activity) => { updates.push(activity); stored = applyActivity(stored, activity); });
  let clock = start;
  const consume = (input: Record<string, unknown>, live = true) => tracker.consume(input, live, clock += 60_000);
  consume({ type: "user", uuid: "human", sessionId: "session", cwd: "/project", message: { content: "/write-nature-paper assets" } });
  return { tracker, updates, consume, state: () => stored! };
}

test("Claude waits for all background agents and preserves the original prompt, turn and total runtime", () => {
  const f = fixture(), original = f.state();
  for (const id of ["a", "b", "c"]) {
    f.consume(launch(id, "Agent", "true"));
    f.consume(result(id, { isAsync: true, status: "async_launched", agentId: `agent-${id}` }));
  }
  f.consume(assistant());
  assert.equal(f.state().status, "running");
  assert.equal(f.state().unread, false);
  assert.equal(f.tracker.completedTurnId, undefined);
  // Claude delivers some notices as attachments and others as synthetic users.
  f.consume({ type: "attachment", attachment: { type: "queued_command", commandMode: "task-notification", prompt: notification("agent-a") } });
  f.consume({ type: "user", uuid: "notice-b", message: { content: [{ type: "text", text: notification("agent-b") }] } });
  f.consume(assistant());
  assert.equal(f.state().status, "running");
  f.consume({ type: "user", uuid: "notice-c", message: { content: notification("agent-c") } });
  assert.equal(f.state().status, "running"); // Receipt is not the main assistant's final report.
  f.consume(assistant());
  assert.equal(f.state().status, "completed");
  assert.equal(f.state().unread, true);
  assert.equal(f.state().title, original.title);
  assert.equal(f.state().turnId, original.turnId);
  assert.equal(f.state().startedAt, original.startedAt);
  assert.ok(f.state().finishedAt! - original.startedAt >= 12 * 60_000);
  const finishedAt = f.state().finishedAt;
  f.consume({ type: "user", message: { content: notification("agent-c") } });
  assert.equal(f.state().status, "completed"); // Duplicate receipts do not reopen completed work.
  assert.equal(f.state().finishedAt, finishedAt);
});

test("background Bash including automatic backgrounding blocks premature main completion", () => {
  const f = fixture();
  f.consume(launch("shell", "Bash", false));
  f.consume(result("shell", { backgroundTaskId: "shell-task" }));
  f.consume(assistant());
  assert.equal(f.state().status, "running");
  f.consume({ type: "user", message: { content: notification("shell-task", "failed") } });
  f.consume(assistant());
  assert.equal(f.state().status, "completed"); // Main agent may handle a child failure successfully.
});

test("structured async workflows stay running until their matching queued result and final response", () => {
  const f = fixture();
  f.consume(assistant([{ type: "tool_use", id: "workflow", name: "Workflow", input: {} }], "tool_use"));
  f.consume(result("workflow", { status: "async_launched", taskId: "workflow-task" }));
  f.consume(assistant());
  assert.equal(f.state().status, "running");
  f.consume({ type: "attachment", attachment: { type: "queued_command", origin: { kind: "task-notification" }, prompt: notification("workflow-task") } });
  assert.equal(f.state().status, "running");
  f.consume(assistant());
  assert.equal(f.state().status, "completed");
});

test("only matching terminal receipts release pending tasks; ordinary tool output cannot spoof them", () => {
  const f = fixture();
  f.consume(launch("a", "Task"));
  f.consume(result("a", { isAsync: true, agentId: "agent-a" }));
  f.consume(result("read", {}, false, notification("agent-a")));
  for (const [id, status, tool] of [["other", "completed", ""], ["agent-a", "running", "a"], ["wrong", "completed", "a"]]) {
    f.consume({ type: "user", message: { content: notification(id, status, tool) } });
    f.consume(assistant());
    assert.equal(f.state().status, "running");
  }
  f.consume({ type: "user", message: { content: notification("agent-a", "cancelled", "a") } });
  f.consume(assistant());
  assert.equal(f.state().status, "completed");
});

test("launch failure and foreground agents do not leave a task permanently running", () => {
  for (const background of [true, false]) {
    const f = fixture();
    f.consume(launch("a", "Agent", background));
    f.consume(result("a", { status: background ? "error" : "completed" }, background));
    f.consume(assistant());
    assert.equal(f.state().status, "completed");
  }
});

test("older launch output and explicit TaskOutput/TaskStop results reconcile the same task", () => {
  for (const name of ["TaskOutput", "TaskStop"]) {
    const f = fixture();
    f.consume(launch("a"));
    f.consume(result("a", undefined, false, [{ type: "text", text: "Async agent launched successfully.\nagentId: old-agent (internal)" }]));
    f.consume(assistant());
    assert.equal(f.state().status, "running");
    f.consume(assistant([{ type: "tool_use", id: "query", name, input: { task_id: "old-agent" } }], "tool_use"));
    f.consume(result("query", { task: { status: "running" } }, name === "TaskStop"));
    f.consume(assistant());
    assert.equal(f.state().status, "running");
    f.consume(assistant([{ type: "tool_use", id: "query2", name, input: { task_id: "old-agent" } }], "tool_use"));
    f.consume(result("query2", { task: { status: "completed" } }));
    f.consume(assistant());
    assert.equal(f.state().status, "completed");
  }
});

test("synthetic notifications alone never create human tasks or unread results", () => {
  const updates: SessionActivity[] = [];
  const tracker = new SessionActivityTracker("claude", "source", (activity) => updates.push(activity));
  tracker.consume({ type: "user", uuid: "notice", sessionId: "session", message: { content: notification("unknown") } }, true, start);
  assert.equal(updates.length, 0);
});

test("historical replay stays silent, retains pending agents and reset removes old lifecycle state", () => {
  const f = fixture();
  f.consume(launch("a"), false);
  f.consume(result("a", { status: "async_launched", agentId: "agent-a" }), false);
  f.consume(assistant(), false);
  f.tracker.flushBaseline(start + 240_000);
  assert.equal(f.updates.at(-1)?.status, "unknown");
  assert.equal(f.updates.at(-1)?.live, false);
  f.consume(assistant());
  assert.equal(f.state().status, "running");
  f.tracker.reset();
  f.consume({ type: "user", uuid: "new", message: { content: "New task" } });
  f.consume(assistant());
  assert.equal(f.state().status, "completed");
});
