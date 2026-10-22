import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { SessionActivity, SessionActivityTracker } from "../sessionActivity";
import { acknowledgementKey, aggregateSessions, applyActivity, atomicWriteJson, isPanelHealthy, panelVisibility, StoredSession, WindowSnapshot } from "../floatingState";

const now = 1_800_000_000_000;
test("panel watchdog treats a hidden panel as healthy and detects stale or missing helpers", () => {
  const heartbeat = { pid: 1234, updatedAt: now, visible: false, version: "0.4.1" };
  assert.equal(isPanelHealthy(heartbeat, now), true);
  assert.equal(isPanelHealthy({ ...heartbeat, visible: true }, now), true);
  assert.equal(isPanelHealthy(undefined, now), false);
  assert.equal(isPanelHealthy({ ...heartbeat, updatedAt: now - 16000 }, now), false);
  assert.equal(isPanelHealthy({ ...heartbeat, pid: 0 }, now), false);
  assert.equal(isPanelHealthy({ ...heartbeat, updatedAt: now + 60000 }, now), false);
});

test("status bar follows the actual visibility of a healthy helper and treats an absent helper as hidden", () => {
  const heartbeat = { pid: 1234, updatedAt: now, visible: true, version: "0.4.4" };
  assert.equal(panelVisibility(heartbeat, undefined, now), true);
  assert.equal(panelVisibility({ ...heartbeat, visible: false }, undefined, now), false);
  assert.equal(panelVisibility({ ...heartbeat, updatedAt: now - 20000 }, undefined, now), false);
  assert.equal(panelVisibility(undefined, undefined, now), false);
});

test("show and hide clicks update state before the native polling loop consumes them", () => {
  const heartbeat = { pid: 1234, updatedAt: now, visible: false, version: "0.4.4", controlId: "old" };
  const show = { type: "show" as const, id: "show", requestedAt: now };
  assert.equal(panelVisibility(heartbeat, show, now), true);
  assert.equal(panelVisibility(undefined, show, now), true);
  assert.equal(panelVisibility({ ...heartbeat, visible: true }, { ...show, type: "hide", id: "hide" }, now), false);
});

test("native acknowledgement allows the close button to override a recently handled show request", () => {
  const heartbeat = { pid: 1234, updatedAt: now, visible: false, version: "0.4.4", controlId: "show" };
  assert.equal(panelVisibility(heartbeat, { type: "show", id: "show", requestedAt: now }, now), false);
});

test("an expired or future show request cannot leave the status bar stuck in the visible state", () => {
  assert.equal(panelVisibility(undefined, { type: "show", id: "old", requestedAt: now - 11000 }, now), false);
  assert.equal(panelVisibility(undefined, { type: "show", id: "future", requestedAt: now + 60000 }, now), false);
});

test("rapid alternating clicks from different windows share the last requested state", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-visibility-"));
  try {
    const file = path.join(folder, "control.json");
    for (const [index, type] of (["show", "hide", "show", "hide"] as const).entries()) {
      atomicWriteJson(file, { type, id: String(index), requestedAt: now });
      const readFromFirstWindow = JSON.parse(fs.readFileSync(file, "utf8"));
      const readFromSecondWindow = JSON.parse(fs.readFileSync(file, "utf8"));
      assert.equal(panelVisibility(undefined, readFromFirstWindow, now), type === "show");
      assert.equal(panelVisibility(undefined, readFromSecondWindow, now), type === "show");
    }
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
function activity(overrides: Partial<SessionActivity> = {}): SessionActivity {
  return { key: "codex:local:session", provider: "codex", sessionId: "session", turnId: "turn-1",
    cwd: "C:/project", title: "Fix login", status: "running", startedAt: now - 1000, updatedAt: now, live: true, ...overrides };
}
function snapshot(windowId: string, session: StoredSession, overrides: Partial<WindowSnapshot> = {}): WindowSnapshot {
  return { version: 1, windowId, workspace: "file:///C:/project", project: "Project", environment: "本地",
    windowHandle: "1", pid: 123, heartbeat: now, sessions: [session], ...overrides };
}
function codexTracker(): { tracker: SessionActivityTracker; updates: SessionActivity[]; removed: string[] } {
  const updates: SessionActivity[] = [];
  const removed: string[] = [];
  const tracker = new SessionActivityTracker("codex", "local", (item, remove) => remove ? removed.push(item.key) : updates.push(item));
  tracker.consume({ type: "session_meta", payload: { id: "session", cwd: "C:/project" } }, false, now);
  return { tracker, updates, removed };
}
const event = (type: string, payload: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "event_msg", timestamp: new Date(now).toISOString(), payload: { type, turn_id: "turn-1", ...payload },
});

test("Codex running -> complete uses the same turn and retains its human title", () => {
  const { tracker, updates } = codexTracker();
  tracker.consume(event("task_started"), true, now);
  tracker.consume(event("user_message", { message: "修复登录问题" }), true, now + 1);
  tracker.consume(event("agent_message", { message: "正在运行测试" }), true, now + 2);
  assert.equal(updates.at(-1)?.status, "running");
  tracker.consume(event("task_complete"), true, now + 3);
  assert.equal(updates.at(-1)?.status, "completed");
  assert.equal(updates.at(-1)?.title, "修复登录问题");
  assert.equal(updates.at(-1)?.turnId, "turn-1");
});

test("child identity survives inherited parent metadata, and late child classification retracts a row", () => {
  const { tracker, updates, removed } = codexTracker();
  tracker.consume(event("task_started"), true, now);
  tracker.consume({ type: "session_meta", payload: { id: "child", source: "subagent" } }, true, now);
  tracker.consume({ type: "session_meta", payload: { id: "parent", cwd: "C:/project" } }, true, now);
  tracker.consume(event("task_complete"), true, now);
  assert.equal(updates.length, 1);
  assert.equal(removed.length, 1);
});

test("aborted turns are unknown instead of completed or running", () => {
  const { tracker, updates } = codexTracker();
  tracker.consume(event("task_started"), true, now);
  tracker.consume(event("turn_aborted"), true, now + 1);
  assert.equal(updates.at(-1)?.status, "unknown");
  tracker.consume(event("error", { message: "Cancelled stream" }), true, now + 2);
  assert.equal(updates.at(-1)?.status, "unknown");
});

test("a Codex error does not finish a task before its completion event", () => {
  const { tracker, updates } = codexTracker();
  tracker.consume(event("task_started"), true, now);
  tracker.consume(event("error", { message: "failed" }), true, now + 1);
  assert.equal(updates.at(-1)?.status, "running");
  tracker.consume(event("task_complete"), true, now + 2);
  assert.equal(updates.at(-1)?.status, "failed");
  tracker.consume(event("task_started", { turn_id: "turn-2" }), true, now + 3);
  tracker.consume(event("task_complete", { turn_id: "turn-2" }), true, now + 4);
  assert.equal(updates.at(-1)?.status, "completed");
});

test("historical baseline does not produce unread results; live completions do", () => {
  assert.equal(applyActivity(undefined, activity({ status: "completed", live: false })).unread, false);
  assert.equal(applyActivity(undefined, activity({ status: "completed" })).unread, true);
});

test("baseline replay after reload preserves a persisted unread completion", () => {
  const previous = applyActivity(undefined, activity({ status: "completed" }));
  assert.equal(applyActivity(previous, activity({ status: "completed", live: false })).unread, true);
  assert.deepEqual(applyActivity(previous, activity({ updatedAt: now - 5000, live: false })), previous);
});

test("Claude tool results and intermediate assistant messages do not finish or replace the human turn", () => {
  const updates: SessionActivity[] = [];
  const tracker = new SessionActivityTracker("claude", "remote-host-a", (item) => updates.push(item));
  tracker.consume({ type: "user", sessionId: "session", cwd: "/work/project", uuid: "human-1",
    message: { content: "训练模型" } }, true, now);
  tracker.consume({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] } }, true, now + 1);
  tracker.consume({ type: "user", uuid: "tool-2", message: { content: [{ type: "tool_result", content: "ok" }] } }, true, now + 2);
  assert.equal(updates.at(-1)?.turnId, "human-1");
  assert.equal(updates.at(-1)?.status, "running");
  tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 3);
  assert.equal(updates.at(-1)?.status, "completed");
  assert.equal(updates.at(-1)?.title, "训练模型");
});

test("Claude subagents never enter the panel", () => {
  let count = 0;
  const tracker = new SessionActivityTracker("claude", "local", () => count++);
  tracker.consume({ type: "user", sessionId: "child", isSidechain: true, uuid: "human",
    message: { content: "subtask" } }, true, now);
  tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now);
  assert.equal(count, 0);
});

test("historical unfinished turns stay hidden until actual live activity resumes", () => {
  const updates: SessionActivity[] = [];
  const tracker = new SessionActivityTracker("claude", "local", (item) => updates.push(item));
  tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human",
    timestamp: new Date(now - 60000).toISOString(), message: { content: "Continue the work" } }, false, now);
  assert.equal(updates.length, 0);
  tracker.flushBaseline(now);
  assert.equal(updates.at(-1)?.status, "unknown");
  assert.equal(updates.at(-1)?.live, false);
  tracker.consume({ type: "assistant", message: { stop_reason: "tool_use" } }, true, now + 1);
  assert.equal(updates.at(-1)?.status, "running");
  assert.equal(updates.at(-1)?.live, true);
});

test("baseline replay reconciles an old completion over a more recent cached running observation", () => {
  const cached = applyActivity(undefined, activity({ provider: "claude", turnId: "human", updatedAt: now - 1000 }));
  let stored = cached;
  const tracker = new SessionActivityTracker("claude", "local", (item) => { stored = applyActivity(stored, item); });
  tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human",
    timestamp: new Date(now - 5 * 3600000).toISOString(), message: { content: "Resume" } }, false, now);
  tracker.consume({ type: "assistant", timestamp: new Date(now - 4 * 3600000).toISOString(),
    message: { stop_reason: "end_turn" } }, false, now);
  tracker.flushBaseline(now);
  assert.equal(stored.status, "completed");
  assert.equal(stored.unread, false);
  assert.equal(stored.updatedAt, now - 4 * 3600000);
  assert.equal(stored.observedAt, now);
});

test("replaying a whole historical file preserves an existing unread final result without emitting earlier turns", () => {
  let stored = applyActivity(undefined, activity({ provider: "claude", turnId: "latest", status: "completed", updatedAt: now - 1 }));
  let emitted = 0;
  const tracker = new SessionActivityTracker("claude", "local", (item) => { emitted++; stored = applyActivity(stored, item); });
  for (const turn of ["earlier", "latest"]) {
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: turn,
      timestamp: new Date(now - 60000).toISOString(), message: { content: "Task" } }, false, now);
    tracker.consume({ type: "assistant", timestamp: new Date(now - 30000).toISOString(),
      message: { stop_reason: "end_turn" } }, false, now);
  }
  tracker.flushBaseline(now);
  assert.equal(emitted, 1);
  assert.equal(stored.turnId, "latest");
  assert.equal(stored.unread, true);
});

test("a reconciled final state wins across windows without making old log activity fresh", () => {
  const cached = applyActivity(undefined, activity({ updatedAt: now - 1000 }));
  const reconciled = applyActivity(undefined, activity({ status: "completed", live: false,
    updatedAt: now - 4 * 3600000, observedAt: now }));
  const rows = aggregateSessions([snapshot("old", cached), snapshot("new", reconciled)], () => false, now);
  assert.equal(rows[0].status, "completed");
  assert.equal(rows[0].unread, false);
  const quiet = { ...reconciled, status: "running" as const, live: true };
  assert.equal(aggregateSessions([snapshot("new", quiet)], () => false, now)[0].status, "unknown");
});

test("legacy baseline-only running rows never count as live work even below 500 minutes", () => {
  const item = applyActivity(undefined, activity({ live: false, startedAt: now - 1000, updatedAt: now }));
  assert.equal(aggregateSessions([snapshot("a", item)], () => false, now)[0].status, "unknown");
});

test("Claude interruption markers stop the current turn rather than starting a phantom user turn", () => {
  for (const marker of ["[Request interrupted by user]", "[Request interrupted by user for tool use]"]) {
    const updates: SessionActivity[] = [];
    const tracker = new SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Real task" } }, true, now);
    tracker.consume({ type: "user", uuid: "marker", message: { content: marker } }, true, now + 1);
    assert.equal(updates.at(-1)?.status, "unknown");
    assert.equal(updates.at(-1)?.turnId, "human");
    assert.equal(updates.at(-1)?.title, "Real task");
    assert.equal(applyActivity(undefined, updates.at(-1)!).unread, false);
  }
});

test("Claude API disconnects hide running work, bookkeeping cannot revive it, and actual assistant activity can", () => {
  const updates: SessionActivity[] = [];
  const tracker = new SessionActivityTracker("claude", "local", (item) => updates.push(item));
  tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Train" } }, true, now);
  tracker.consume({ type: "system", subtype: "api_error", retryAttempt: 1, maxRetries: 10, error: { message: "Connection error." } }, true, now + 1);
  assert.equal(updates.at(-1)?.status, "unknown");
  tracker.consume({ type: "progress", data: { type: "hook_progress" } }, true, now + 2);
  tracker.consume({ type: "last-prompt", sessionId: "session" }, true, now + 3);
  assert.equal(updates.at(-1)?.status, "unknown");
  tracker.consume({ type: "assistant", message: { stop_reason: "tool_use" } }, true, now + 4);
  assert.equal(updates.at(-1)?.status, "running");
  tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 5);
  assert.equal(updates.at(-1)?.status, "completed");
});

test("Claude synthetic API errors and truncated responses do not create unread completions", () => {
  for (const terminal of [
    { type: "assistant", isApiErrorMessage: true, message: { stop_reason: "end_turn" } },
    { type: "assistant", message: { stop_reason: "max_tokens" } },
  ]) {
    const updates: SessionActivity[] = [];
    const tracker = new SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Task" } }, true, now);
    tracker.consume(terminal, true, now + 1);
    assert.equal(updates.at(-1)?.status, "unknown");
    assert.equal(applyActivity(undefined, updates.at(-1)!).unread, false);
  }
});

test("resume wording in a genuine prompt is not a reason to hide an active turn", () => {
  const updates: SessionActivity[] = [];
  const tracker = new SessionActivityTracker("claude", "local", (item) => updates.push(item));
  tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human",
    message: { content: "Your response above was cut off mid-stream. Resume directly." } }, true, now);
  assert.equal(updates.at(-1)?.status, "running");
});

test("Codex historical replay publishes only its final state and resumes on live logs", () => {
  const { tracker, updates } = codexTracker();
  tracker.consume(event("task_started"), false, now);
  tracker.consume(event("user_message", { message: "Task" }), false, now);
  assert.equal(updates.length, 0);
  tracker.flushBaseline(now);
  assert.equal(updates.at(-1)?.status, "unknown");
  tracker.consume(event("agent_message"), true, now + 1);
  assert.equal(updates.at(-1)?.status, "running");
});

test("duplicate observations show one row with all matching windows", () => {
  const item = applyActivity(undefined, activity());
  const rows = aggregateSessions([snapshot("window-a", item), snapshot("window-b", item)], () => false, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].owners.length, 2);
});

test("same session ids on different remote hosts stay separate", () => {
  const a = applyActivity(undefined, activity({ key: "codex:host-a:session" }));
  const b = applyActivity(undefined, activity({ key: "codex:host-b:session" }));
  assert.equal(aggregateSessions([snapshot("a", a), snapshot("b", b)], () => false, now).length, 2);
});

test("closed windows, stale heartbeats and quiet tasks become unknown", () => {
  const item = applyActivity(undefined, activity());
  for (const overrides of [{ closed: true }, { heartbeat: now - 16000 }]) {
    assert.equal(aggregateSessions([snapshot("a", item, overrides)], () => false, now)[0].status, "unknown");
  }
  const quiet = { ...item, updatedAt: now - 31 * 60000 };
  assert.equal(aggregateSessions([snapshot("a", quiet)], () => false, now)[0].status, "unknown");
});

test("one active observer keeps a shared task running even when another window closes", () => {
  const item = applyActivity(undefined, activity());
  const row = aggregateSessions([snapshot("a", item, { closed: true }), snapshot("b", item)], () => false, now)[0];
  assert.equal(row.status, "running");
  assert.equal(row.owners[0].windowId, "b");
});

test("read acknowledgements synchronize across windows and apply only to the selected turn", () => {
  const item = applyActivity(undefined, activity({ status: "completed" }));
  const readKey = acknowledgementKey(item);
  assert.equal(aggregateSessions([snapshot("a", item)], (key) => key === readKey, now)[0].unread, false);
  const next = applyActivity(item, activity({ turnId: "turn-2", updatedAt: now + 10, status: "completed" }));
  assert.equal(aggregateSessions([snapshot("a", next)], (key) => key === readKey, now + 10)[0].unread, true);
});

test("unread results survive closed windows and age, and sort before running tasks", () => {
  const unread = applyActivity(undefined, activity({ key: "old", status: "completed", updatedAt: now - 3 * 86400000 }));
  const running = applyActivity(undefined, activity());
  const rows = aggregateSessions([snapshot("a", running), snapshot("b", unread, { closed: true })], () => false, now);
  assert.equal(rows[0].key, "old");
  assert.equal(rows[0].unread, true);
  assert.equal(rows[1].status, "running");
});

test("24-hour history retention hides reviewed results, never an unfinished long-running task", () => {
  const oldTime = now - 3 * 86400000;
  const reviewed = applyActivity(undefined, activity({ key: "reviewed", status: "completed", live: false, updatedAt: oldTime }));
  const unfinished = applyActivity(undefined, activity({ key: "unfinished", updatedAt: oldTime }));
  const rows = aggregateSessions([snapshot("a", reviewed), snapshot("b", unfinished)], () => false, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key, "unfinished");
  assert.equal(rows[0].status, "unknown");
});

test("shared snapshot replacement is valid JSON and leaves no temporary files", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-panel-"));
  try {
    const file = path.join(folder, "window.json");
    atomicWriteJson(file, { title: "中文标题", version: 1 });
    atomicWriteJson(file, { title: "中文标题", version: 2 });
    assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2);
    assert.deepEqual(fs.readdirSync(folder), ["window.json"]);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
