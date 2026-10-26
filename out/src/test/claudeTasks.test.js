"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sessionActivity_1 = require("../sessionActivity");
const floatingState_1 = require("../floatingState");
const start = 1_800_000_000_000;
const assistant = (content = [], stop_reason = "end_turn") => ({ type: "assistant", message: { content, stop_reason } });
const launch = (id, name = "Agent", run_in_background = true) => assistant([
    { type: "tool_use", id, name, input: { run_in_background } },
], "tool_use");
const result = (id, toolUseResult, is_error = false, content = "launched") => ({ type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, is_error, content }] }, toolUseResult });
const notification = (id, status = "completed", toolId = "") => `<task-notification><task-id>${id}</task-id><status>${status}</status>${toolId ? `<tool-use-id>${toolId}</tool-use-id>` : ""}</task-notification>`;
function fixture() {
    const updates = [];
    let stored;
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "source", (activity) => { updates.push(activity); stored = (0, floatingState_1.applyActivity)(stored, activity); });
    let clock = start;
    const consume = (input, live = true) => tracker.consume(input, live, clock += 60_000);
    consume({ type: "user", uuid: "human", sessionId: "session", cwd: "/project", message: { content: "/write-nature-paper assets" } });
    return { tracker, updates, consume, state: () => stored };
}
(0, node_test_1.default)("Claude waits for all background agents and preserves the original prompt, turn and total runtime", () => {
    const f = fixture(), original = f.state();
    for (const id of ["a", "b", "c"]) {
        f.consume(launch(id, "Agent", "true"));
        f.consume(result(id, { isAsync: true, status: "async_launched", agentId: `agent-${id}` }));
    }
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "running");
    strict_1.default.equal(f.state().unread, false);
    strict_1.default.equal(f.tracker.completedTurnId, undefined);
    // Claude delivers some notices as attachments and others as synthetic users.
    f.consume({ type: "attachment", attachment: { type: "queued_command", commandMode: "task-notification", prompt: notification("agent-a") } });
    f.consume({ type: "user", uuid: "notice-b", message: { content: [{ type: "text", text: notification("agent-b") }] } });
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "running");
    f.consume({ type: "user", uuid: "notice-c", message: { content: notification("agent-c") } });
    strict_1.default.equal(f.state().status, "running"); // Receipt is not the main assistant's final report.
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "completed");
    strict_1.default.equal(f.state().unread, true);
    strict_1.default.equal(f.state().title, original.title);
    strict_1.default.equal(f.state().turnId, original.turnId);
    strict_1.default.equal(f.state().startedAt, original.startedAt);
    strict_1.default.ok(f.state().finishedAt - original.startedAt >= 12 * 60_000);
    const finishedAt = f.state().finishedAt;
    f.consume({ type: "user", message: { content: notification("agent-c") } });
    strict_1.default.equal(f.state().status, "completed"); // Duplicate receipts do not reopen completed work.
    strict_1.default.equal(f.state().finishedAt, finishedAt);
});
(0, node_test_1.default)("background Bash including automatic backgrounding blocks premature main completion", () => {
    const f = fixture();
    f.consume(launch("shell", "Bash", false));
    f.consume(result("shell", { backgroundTaskId: "shell-task" }));
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "running");
    f.consume({ type: "user", message: { content: notification("shell-task", "failed") } });
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "completed"); // Main agent may handle a child failure successfully.
});
(0, node_test_1.default)("structured async workflows stay running until their matching queued result and final response", () => {
    const f = fixture();
    f.consume(assistant([{ type: "tool_use", id: "workflow", name: "Workflow", input: {} }], "tool_use"));
    f.consume(result("workflow", { status: "async_launched", taskId: "workflow-task" }));
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "running");
    f.consume({ type: "attachment", attachment: { type: "queued_command", origin: { kind: "task-notification" }, prompt: notification("workflow-task") } });
    strict_1.default.equal(f.state().status, "running");
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "completed");
});
(0, node_test_1.default)("only matching terminal receipts release pending tasks; ordinary tool output cannot spoof them", () => {
    const f = fixture();
    f.consume(launch("a", "Task"));
    f.consume(result("a", { isAsync: true, agentId: "agent-a" }));
    f.consume(result("read", {}, false, notification("agent-a")));
    for (const [id, status, tool] of [["other", "completed", ""], ["agent-a", "running", "a"], ["wrong", "completed", "a"]]) {
        f.consume({ type: "user", message: { content: notification(id, status, tool) } });
        f.consume(assistant());
        strict_1.default.equal(f.state().status, "running");
    }
    f.consume({ type: "user", message: { content: notification("agent-a", "cancelled", "a") } });
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "completed");
});
(0, node_test_1.default)("launch failure and foreground agents do not leave a task permanently running", () => {
    for (const background of [true, false]) {
        const f = fixture();
        f.consume(launch("a", "Agent", background));
        f.consume(result("a", { status: background ? "error" : "completed" }, background));
        f.consume(assistant());
        strict_1.default.equal(f.state().status, "completed");
    }
});
(0, node_test_1.default)("older launch output and explicit TaskOutput/TaskStop results reconcile the same task", () => {
    for (const name of ["TaskOutput", "TaskStop"]) {
        const f = fixture();
        f.consume(launch("a"));
        f.consume(result("a", undefined, false, [{ type: "text", text: "Async agent launched successfully.\nagentId: old-agent (internal)" }]));
        f.consume(assistant());
        strict_1.default.equal(f.state().status, "running");
        f.consume(assistant([{ type: "tool_use", id: "query", name, input: { task_id: "old-agent" } }], "tool_use"));
        f.consume(result("query", { task: { status: "running" } }, name === "TaskStop"));
        f.consume(assistant());
        strict_1.default.equal(f.state().status, "running");
        f.consume(assistant([{ type: "tool_use", id: "query2", name, input: { task_id: "old-agent" } }], "tool_use"));
        f.consume(result("query2", { task: { status: "completed" } }));
        f.consume(assistant());
        strict_1.default.equal(f.state().status, "completed");
    }
});
(0, node_test_1.default)("synthetic notifications alone never create human tasks or unread results", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "source", (activity) => updates.push(activity));
    tracker.consume({ type: "user", uuid: "notice", sessionId: "session", message: { content: notification("unknown") } }, true, start);
    strict_1.default.equal(updates.length, 0);
});
(0, node_test_1.default)("historical replay stays silent, retains pending agents and reset removes old lifecycle state", () => {
    const f = fixture();
    f.consume(launch("a"), false);
    f.consume(result("a", { status: "async_launched", agentId: "agent-a" }), false);
    f.consume(assistant(), false);
    f.tracker.flushBaseline(start + 240_000);
    strict_1.default.equal(f.updates.at(-1)?.status, "unknown");
    strict_1.default.equal(f.updates.at(-1)?.live, false);
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "running");
    f.tracker.reset();
    f.consume({ type: "user", uuid: "new", message: { content: "New task" } });
    f.consume(assistant());
    strict_1.default.equal(f.state().status, "completed");
});
