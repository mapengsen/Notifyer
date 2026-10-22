import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { SessionActivity, SessionActivityTracker } from "../sessionActivity";
import { acknowledgementKey, aggregateSessions, applyActivity, atomicWriteJson, isPanelHealthy, StoredSession, WindowSnapshot } from "../floatingState";

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
