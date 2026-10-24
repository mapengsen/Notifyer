import assert from "node:assert/strict";
import test from "node:test";
import { SessionActivity, SessionActivityTracker } from "../sessionActivity";
import { SessionQuestions } from "../sessionQuestions";
import { aggregateSessions, applyActivity, StoredSession, WindowSnapshot } from "../floatingState";

const now = 1_800_000_000_000;
const request = (id = "ask-a", count = 1, asynchronous = true) => ({ type: "function_call", name: asynchronous ? "request_user_input_async" : "request_user_input",
  call_id: id, arguments: JSON.stringify({ questions: Array.from({ length: count }, (_, index) => ({ title: `Question ${index + 1}`, question: `Question ${index + 1}` })) }) });
const output = (id = "ask-a", result: unknown = { accepted: true }) => ({ type: "function_call_output", call_id: id, output: JSON.stringify(result) });
const replyText = (id = "ask-a", index = 0) => `<send_user_message_question_reply>\n${JSON.stringify([{ questionItemId: JSON.stringify(["request_user_input_async", id, index]), answer: "Chosen answer" }])}\n</send_user_message_question_reply>`;
const reply = (id = "ask-a", index = 0) => ({ type: "message", role: "user", content: [{ type: "input_text", text: replyText(id, index) }] });

test("async question submission stays pending until its matching user reply", () => {
  const questions = new SessionQuestions();
  questions.consumeCodex(request(), now);
  assert.equal(questions.attention?.count, 1);
  questions.consumeCodex(output(), now + 1);
  assert.equal(questions.attention?.count, 1); // accepted is not an answer
  questions.consumeCodex(reply("other-call"), now + 2);
  assert.equal(questions.attention?.count, 1);
  questions.consumeCodex(reply(), now + 3);
  assert.equal(questions.attention, undefined);
});

test("multiple async questions clear individually and survive completion of the asking turn", () => {
  const questions = new SessionQuestions();
  questions.consumeCodex(request("a", 2), now);
  questions.consumeCodex(request("b"), now + 1);
  questions.finishTurn();
  assert.equal(questions.attention?.count, 3);
  questions.consumeCodex(reply("a", 0), now + 2);
  assert.equal(questions.attention?.count, 2);
  assert.equal(questions.attention?.message, "Question 2");
  questions.consumeCodex(reply("b"), now + 3);
  assert.deepEqual(questions.attention?.requestIds, ["a"]);
  questions.consumeCodex(reply("a", 1), now + 4);
  assert.equal(questions.attention, undefined);
});

test("synchronous answers, tool failures and rejected async requests remove their own questions", () => {
  const questions = new SessionQuestions();
  questions.consumeCodex(request("async"), now);
  questions.consumeCodex(request("sync", 1, false), now);
  questions.consumeCodex(output("unrelated"), now + 1);
  assert.equal(questions.attention?.count, 2);
  questions.consumeCodex(output("sync", { answers: { topic: { answers: ["yes"] } } }), now + 2);
  assert.deepEqual(questions.attention?.requestIds, ["async"]);
  questions.consumeCodex(output("async", { accepted: false, error: "cancelled" }), now + 3);
  assert.equal(questions.attention, undefined);
  questions.consumeCodex(request("sync-2", 1, false), now + 4);
  questions.finishTurn();
  assert.equal(questions.attention, undefined);
});

test("invalid requests, normal tools and question-like prose cannot create a pending question", () => {
  const questions = new SessionQuestions();
  for (const payload of [request("empty", 0), { ...request(), arguments: "{" }, { ...request(), call_id: "" },
    { ...request(), name: "exec_command" }, { type: "message", role: "assistant", content: [{ type: "output_text", text: "Would you like to continue?" }] }]) {
    questions.consumeCodex(payload, now);
  }
  assert.equal(Boolean(questions.attention), false);
  questions.consumeCodex(request(), now);
  questions.consumeReplyText("<send_user_message_question_reply>malformed</send_user_message_question_reply>");
  assert.equal(questions.attention?.count, 1);
});

test("Claude AskUserQuestion remains pending until that tool's actual result", () => {
  const questions = new SessionQuestions();
  questions.consumeClaude({ type: "assistant", message: { content: [{ type: "tool_use", id: "claude-ask", name: "AskUserQuestion", input: { questions: [{ question: "Which option?" }] } }] } }, now);
  assert.equal(questions.attention?.message, "Which option?");
  questions.consumeClaude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "other", content: "ok" }] } }, now + 1);
  assert.equal(questions.attention?.count, 1);
  questions.consumeClaude({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "claude-ask", content: "User chose option 1" }] } }, now + 2);
  assert.equal(questions.attention, undefined);
});

function tracker() {
  const updates: SessionActivity[] = [];
  const activity = new SessionActivityTracker("codex", "remote", (item) => updates.push(item));
  activity.consume({ type: "session_meta", payload: { id: "session", cwd: "/work" } }, false, now);
  const event = (type: string, turn = "turn-a", extra = {}) => activity.consume({ type: "event_msg", payload: { type, turn_id: turn, ...extra } }, true, now);
  const consume = (payload: Record<string, unknown>, live = true) => activity.consume({ type: "response_item", payload }, live, now);
  return { activity, updates, event, consume };
}

test("Codex questions pass through production activity tracking and clear on a response-item reply", () => {
  const f = tracker();
  f.event("task_started");
  f.event("user_message", "turn-a", { message: "Real task" });
  f.consume(request());
  f.consume(output());
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  f.consume({ type: "reasoning" });
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  f.event("task_complete");
  assert.equal(f.updates.at(-1)?.status, "completed");
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  f.consume(reply());
  assert.equal(f.updates.at(-1)?.attention, undefined);
  assert.equal(f.updates.at(-1)?.title, "Real task");
});

test("baseline replay reconciles unanswered questions without replaying answered ones", () => {
  const f = tracker();
  f.consume(request(), false);
  f.consume(output(), false);
  f.activity.flushBaseline(now);
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  assert.equal(f.updates.at(-1)?.live, false);
  f.consume(reply(), false);
  f.activity.flushBaseline(now);
  assert.equal(f.updates.at(-1)?.attention, undefined);
});

test("new turns and unrelated aborts preserve async questions until their own answer", () => {
  const f = tracker();
  f.event("task_started");
  f.consume(request());
  f.event("task_complete");
  f.event("task_started", "turn-b");
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  f.event("turn_aborted", "turn-b");
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  f.consume(reply());
  assert.equal(f.updates.at(-1)?.attention, undefined);
  f.event("task_started", "turn-c");
  f.consume(request("sync", 1, false));
  assert.equal(f.updates.at(-1)?.attention?.count, 1);
  f.event("turn_aborted", "turn-c");
  assert.equal(f.updates.at(-1)?.attention, undefined);
});

test("Claude activity tracking publishes and resolves question badges within the same human turn", () => {
  const updates: SessionActivity[] = [];
  const activity = new SessionActivityTracker("claude", "local", (item) => updates.push(item));
  activity.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Do work" } }, true, now);
  activity.consume({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "AskUserQuestion", id: "ask", input: { questions: [{ question: "Continue?" }] } }] } }, true, now + 1);
  assert.equal(updates.at(-1)?.attention?.count, 1);
  activity.consume({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "ask", content: "yes" }] } }, true, now + 2);
  assert.equal(updates.at(-1)?.attention, undefined);
  assert.equal(updates.at(-1)?.turnId, "human");
  assert.equal(updates.at(-1)?.status, "running");
});

test("question cards sort first and survive review acknowledgements, quiet timeouts and closed windows", () => {
  const base: StoredSession = { key: "question", provider: "codex", sessionId: "session", turnId: "turn", cwd: "/work", title: "Task", status: "completed", live: false,
    startedAt: now - 3 * 86_400_000, updatedAt: now - 2 * 86_400_000, unread: false,
    attention: { requestIds: ["ask"], count: 1, message: "Continue?", askedAt: now - 2 * 86_400_000 } };
  const snapshot: WindowSnapshot = { version: 1, windowId: "window", workspace: "file:///work", project: "Project", environment: "local", windowHandle: "1", pid: 1, heartbeat: now, closed: true,
    sessions: [{ ...base, key: "ordinary", attention: undefined, status: "running", updatedAt: now, live: true }, base] };
  const rows = aggregateSessions([snapshot], () => true, now);
  assert.equal(rows[0].key, "question");
  assert.equal(rows[0].attention?.count, 1);
  assert.equal(rows[0].unread, false);
  const resolved = applyActivity(base, { ...base, attention: undefined, observedAt: now });
  assert.equal(resolved.attention, undefined);
});
