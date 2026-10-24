"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const sessionActivity_1 = require("../sessionActivity");
const sessionQuestions_1 = require("../sessionQuestions");
const floatingState_1 = require("../floatingState");
const now = 1_800_000_000_000;
const request = (id = "ask-a", count = 1, asynchronous = true) => ({ type: "function_call", name: asynchronous ? "request_user_input_async" : "request_user_input",
    call_id: id, arguments: JSON.stringify({ questions: Array.from({ length: count }, (_, index) => ({ title: `Question ${index + 1}`, question: `Question ${index + 1}` })) }) });
const output = (id = "ask-a", result = { accepted: true }) => ({ type: "function_call_output", call_id: id, output: JSON.stringify(result) });
const replyText = (id = "ask-a", index = 0) => `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: JSON.stringify(["request_user_input_async", id, index]), answer: "Chosen answer" }])}\n</send_user_message_question_reply>`;
const reply = (id = "ask-a", index = 0) => ({ type: "message", role: "user", content: [{ type: "input_text", text: replyText(id, index) }] });
(0, node_test_1.default)("async question submission stays pending until its matching user reply", () => {
    const questions = new sessionQuestions_1.SessionQuestions();
    questions.consumeCodex(request(), now);
    strict_1.default.equal(questions.attention?.count, 1);
    questions.consumeCodex(output(), now + 1);
    strict_1.default.equal(questions.attention?.count, 1); // accepted is not an answer
    questions.consumeCodex(reply("other-call"), now + 2);
    strict_1.default.equal(questions.attention?.count, 1);
    questions.consumeCodex(reply(), now + 3);
    strict_1.default.equal(questions.attention, undefined);
});
(0, node_test_1.default)("multiple async questions clear individually and survive completion of the asking turn", () => {
    const questions = new sessionQuestions_1.SessionQuestions();
    questions.consumeCodex(request("a", 2), now);
    questions.consumeCodex(request("b"), now + 1);
    questions.finishTurn();
    strict_1.default.equal(questions.attention?.count, 3);
    questions.consumeCodex(reply("a", 0), now + 2);
    strict_1.default.equal(questions.attention?.count, 2);
    strict_1.default.equal(questions.attention?.message, "Question 2");
    questions.consumeCodex(reply("b"), now + 3);
    strict_1.default.deepEqual(questions.attention?.requestIds, ["a"]);
    questions.consumeCodex(reply("a", 1), now + 4);
    strict_1.default.equal(questions.attention, undefined);
});
(0, node_test_1.default)("synchronous answers, tool failures and rejected async requests remove their own questions", () => {
    const questions = new sessionQuestions_1.SessionQuestions();
    questions.consumeCodex(request("async"), now);
    questions.consumeCodex(request("sync", 1, false), now);
    questions.consumeCodex(output("unrelated"), now + 1);
    strict_1.default.equal(questions.attention?.count, 2);
    questions.consumeCodex(output("sync", { answers: { topic: { answers: ["yes"] } } }), now + 2);
    strict_1.default.deepEqual(questions.attention?.requestIds, ["async"]);
    questions.consumeCodex(output("async", { accepted: false, error: "cancelled" }), now + 3);
    strict_1.default.equal(questions.attention, undefined);
    questions.consumeCodex(request("sync-2", 1, false), now + 4);
    questions.finishTurn();
    strict_1.default.equal(questions.attention, undefined);
});
(0, node_test_1.default)("invalid requests, normal tools and question-like prose cannot create a pending question", () => {
    const questions = new sessionQuestions_1.SessionQuestions();
    for (const payload of [request("empty", 0), { ...request(), arguments: "{" }, { ...request(), call_id: "" },
        { ...request(), name: "exec_command" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "Would you like to continue?" }] }]) {
        questions.consumeCodex(payload, now);
    }
    strict_1.default.equal(Boolean(questions.attention), false);
    questions.consumeCodex(request(), now);
    questions.consumeReplyText("<send_user_message_question_reply>malformed</send_user_message_question_reply>");
    strict_1.default.equal(questions.attention?.count, 1);
});
(0, node_test_1.default)("Claude AskUserQuestion remains pending until that tool's actual result", () => {
    const questions = new sessionQuestions_1.SessionQuestions();
    questions.consumeClaude({ type: "assistant", message: { content: [{ type: "tool_use", id: "claude-ask", name: "AskUserQuestion", input: { questions: [{ question: "Which option?" }] } }] } }, now);
    strict_1.default.equal(questions.attention?.message, "Which option?");
    questions.consumeClaude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "other", content: "ok" }] } }, now + 1);
    strict_1.default.equal(questions.attention?.count, 1);
    questions.consumeClaude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "claude-ask", content: "User chose option 1" }] } }, now + 2);
    strict_1.default.equal(questions.attention, undefined);
});
function tracker() {
    const updates = [];
    const activity = new sessionActivity_1.SessionActivityTracker("codex", "remote", (item) => updates.push(item));
    activity.consume({ type: "session_meta", payload: { id: "session", cwd: "/work" } }, false, now);
    const event = (type, turn = "turn-a", extra = {}) => activity.consume({ type: "event_msg", payload: { type, turn_id: turn, ...extra } }, true, now);
    const consume = (payload, live = true) => activity.consume({ type: "response_item", payload }, live, now);
    return { activity, updates, event, consume };
}
(0, node_test_1.default)("Codex questions pass through production activity tracking and clear on a response-item reply", () => {
    const f = tracker();
    f.event("task_started");
    f.event("user_message", "turn-a", { message: "Real task" });
    f.consume(request());
    f.consume(output());
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    f.consume({ type: "reasoning" });
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    f.event("task_complete");
    strict_1.default.equal(f.updates.at(-1)?.status, "completed");
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    f.consume(reply());
    strict_1.default.equal(f.updates.at(-1)?.attention, undefined);
    strict_1.default.equal(f.updates.at(-1)?.title, "Real task");
});
(0, node_test_1.default)("baseline replay reconciles unanswered questions without replaying answered ones", () => {
    const f = tracker();
    f.consume(request(), false);
    f.consume(output(), false);
    f.activity.flushBaseline(now);
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    strict_1.default.equal(f.updates.at(-1)?.live, false);
    f.consume(reply(), false);
    f.activity.flushBaseline(now);
    strict_1.default.equal(f.updates.at(-1)?.attention, undefined);
});
(0, node_test_1.default)("new turns and unrelated aborts preserve async questions until their own answer", () => {
    const f = tracker();
    f.event("task_started");
    f.consume(request());
    f.event("task_complete");
    f.event("task_started", "turn-b");
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    f.event("turn_aborted", "turn-b");
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    f.consume(reply());
    strict_1.default.equal(f.updates.at(-1)?.attention, undefined);
    f.event("task_started", "turn-c");
    f.consume(request("sync", 1, false));
    strict_1.default.equal(f.updates.at(-1)?.attention?.count, 1);
    f.event("turn_aborted", "turn-c");
    strict_1.default.equal(f.updates.at(-1)?.attention, undefined);
});
(0, node_test_1.default)("Claude activity tracking publishes and resolves question badges within the same human turn", () => {
    const updates = [];
    const activity = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    activity.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Do work" } }, true, now);
    activity.consume({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "AskUserQuestion", id: "ask", input: { questions: [{ question: "Continue?" }] } }] } }, true, now + 1);
    strict_1.default.equal(updates.at(-1)?.attention?.count, 1);
    activity.consume({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ask", content: "yes" }] } }, true, now + 2);
    strict_1.default.equal(updates.at(-1)?.attention, undefined);
    strict_1.default.equal(updates.at(-1)?.turnId, "human");
    strict_1.default.equal(updates.at(-1)?.status, "running");
});
(0, node_test_1.default)("question cards sort first and survive review acknowledgements, quiet timeouts and closed windows", () => {
    const base = { key: "question", provider: "codex", sessionId: "session", turnId: "turn", cwd: "/work", title: "Task", status: "completed", live: false,
        startedAt: now - 3 * 86_400_000, updatedAt: now - 2 * 86_400_000, unread: false,
        attention: { requestIds: ["ask"], count: 1, message: "Continue?", askedAt: now - 2 * 86_400_000 } };
    const snapshot = { version: 1, windowId: "window", workspace: "file:///work", project: "Project", environment: "local", windowHandle: "1", pid: 1, heartbeat: now, closed: true,
        sessions: [{ ...base, key: "ordinary", attention: undefined, status: "running", updatedAt: now, live: true }, base] };
    const rows = (0, floatingState_1.aggregateSessions)([snapshot], () => true, now);
    strict_1.default.equal(rows[0].key, "question");
    strict_1.default.equal(rows[0].attention?.count, 1);
    strict_1.default.equal(rows[0].unread, false);
    const resolved = (0, floatingState_1.applyActivity)(base, { ...base, attention: undefined, observedAt: now });
    strict_1.default.equal(resolved.attention, undefined);
});
