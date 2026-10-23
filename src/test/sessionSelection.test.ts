import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { acknowledgementKey, StoredSession } from "../floatingState";
import { ProviderStateReader } from "../providerStateReader";
import { claudeUnread, ClaudeReadTracker, isPendingResult, matchingResult, selectedClaudeSession, viewedResult } from "../sessionSelection";

const viewType = "mainThreadWebview-claudeVSCodePanel";
function fixture() {
  const panels = [{ sessionId: "session-a", title: "First conversation" }, { sessionId: "session-b", title: "Second conversation" }];
  const editors = panels.map((panel) => ({ id: "workbench.editors.webviewInput", value: JSON.stringify({
    viewType, extensionId: "Anthropic.claude-code", title: panel.title, state: JSON.stringify({ sessionID: panel.sessionId }),
  }) }));
  const leaf = { type: "leaf", data: { id: 2, editors, mru: [0, 1] } };
  const state = { "editorpart.state": { serializedGrid: { root: { type: "branch", data: [leaf] } } } };
  const provider = { panelTabSessions: panels };
  const live = { selected: 0, tabs: panels.map((panel) => ({ label: panel.title, viewType })) };
  return { state, provider, live, leaf, editors };
}
function session(id = "session-a", overrides: Partial<StoredSession> = {}): StoredSession {
  return { key: `claude:vscode-remote://ssh-remote+server/root/${id}.jsonl:${id}`, provider: "claude", sessionId: id,
    turnId: "turn-a", cwd: "/work", title: "same prompt", status: "completed", startedAt: 1000,
    updatedAt: 2000, unread: true, live: true, ...overrides };
}

test("manual Claude tab selection resolves each exact session ID in the same VS Code window", () => {
  const f = fixture();
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), "session-a");
  f.live.selected = 1;
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), "session-b");
});

test("selection follows the live active tab rather than the persisted most-recent tab", () => {
  const f = fixture();
  f.leaf.data.mru = [1, 0];
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), "session-a");
});

test("changed tab order, new tabs, reused sessions and unknown editor state preserve pending results", () => {
  const f = fixture();
  assert.equal(selectedClaudeSession(f.state, f.provider, { ...f.live, tabs: [...f.live.tabs].reverse() }), undefined);
  assert.equal(selectedClaudeSession(f.state, f.provider, { ...f.live, tabs: [...f.live.tabs, f.live.tabs[0]] }), undefined);
  assert.equal(selectedClaudeSession(f.state, { panelTabSessions: [{ ...f.provider.panelTabSessions[0], sessionId: "reused-panel" }] }, f.live), undefined);
  assert.equal(selectedClaudeSession({}, f.provider, f.live), undefined);
  assert.equal(selectedClaudeSession("broken JSON", f.provider, f.live), undefined);
  assert.equal(selectedClaudeSession(f.state, f.provider, { ...f.live, selected: -1 }), undefined);
});

test("identical-looking tabs and duplicate matching groups are ambiguous and never guessed", () => {
  const f = fixture();
  f.state["editorpart.state"].serializedGrid.root.data.push(f.leaf);
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), undefined);
  f.state["editorpart.state"].serializedGrid.root.data.pop();
  f.provider.panelTabSessions[1].title = f.provider.panelTabSessions[0].title;
  f.live.tabs[1].label = f.live.tabs[0].label;
  const saved = JSON.parse(f.editors[1].value);
  saved.title = f.live.tabs[0].label;
  f.editors[1].value = JSON.stringify(saved);
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), undefined);
});

test("another provider's webview and malformed session IDs cannot mark a Claude result read", () => {
  const f = fixture();
  const saved = JSON.parse(f.editors[0].value);
  saved.extensionId = "other.extension";
  f.editors[0].value = JSON.stringify(saved);
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), undefined);
  saved.extensionId = "Anthropic.claude-code";
  saved.state = JSON.stringify({ sessionID: "../other" });
  f.editors[0].value = JSON.stringify(saved);
  assert.equal(selectedClaudeSession(f.state, f.provider, f.live), undefined);
});

test("Claude native read state is scoped to the exact workspace and missing state is unknown", () => {
  const state = { "sessionUnread:/work": ["session-a"], "sessionUnread:/other": ["session-b"], "sessionUnread:/invalid": "bad" };
  assert.deepEqual(claudeUnread(state, ["/work"]), new Set(["session-a"]));
  assert.deepEqual(claudeUnread(state, ["/work/"]), new Set(["session-a"]));
  assert.deepEqual(claudeUnread({ "sessionUnread:/work": [] }, ["/work/.claude/worktrees/topic"]), new Set());
  assert.equal(claudeUnread(state, ["/missing"]), undefined);
  assert.equal(claudeUnread(state, ["/invalid"]), undefined);
  assert.equal(claudeUnread(undefined, ["/work"]), undefined);
});

test("native read scopes normalize Windows path casing while keeping remote POSIX paths case-sensitive", () => {
  assert.deepEqual(claudeUnread({ "sessionUnread:C:\\Work\\Project": ["session-a"] }, ["c:/work/project/"]), new Set(["session-a"]));
  assert.equal(claudeUnread({ "sessionUnread:/Work/Project": [] }, ["/work/project"]), undefined);
});

test("a provider read transition removes only that session's pending turn", () => {
  const tracker = new ClaudeReadTracker();
  const a = session(), b = session("session-b");
  assert.deepEqual(tracker.consume(new Set(["session-a", "session-b"]), [a, b]), []);
  assert.deepEqual(tracker.consume(new Set(["session-b"]), [a, b]), [viewedResult(a)]);
  assert.deepEqual(tracker.consume(new Set(), [a, b]), [viewedResult(b)]);
});

test("native read baseline, corrupt data and later completions never clear unrelated results", () => {
  const tracker = new ClaudeReadTracker();
  const a = session();
  assert.deepEqual(tracker.consume(new Set(), [a]), []);
  assert.deepEqual(tracker.consume(new Set(["session-a"]), [a]), []);
  assert.deepEqual(tracker.consume(undefined, [a]), []);
  assert.deepEqual(tracker.consume(new Set(), [session("session-a", { turnId: "new-turn" })]), []);
  assert.deepEqual(tracker.consume(new Set(), [a]), []);
});

test("session and turn identities prevent reading duplicate sources or newer results", () => {
  const a = session(), result = viewedResult(a);
  assert.equal(matchingResult([a, { ...a, key: "other-source" }], "claude", "session-a"), undefined);
  assert.equal(matchingResult([a], "codex", "session-a"), undefined);
  assert.equal(isPendingResult(a, result), true);
  assert.equal(isPendingResult({ ...a, turnId: "new-turn" }, result), false);
  assert.equal(isPendingResult({ ...a, status: "running" }, result), false);
  assert.equal(isPendingResult({ ...a, status: "failed" }, result), false);
  assert.equal(result.acknowledgement, acknowledgementKey(a));
});

test("provider storage reader uses readonly SQLite and reads only named namespaces, case-insensitively", () => {
  const { DatabaseSync } = require("node:sqlite");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-selection-"));
  const file = path.join(folder, "state.vscdb");
  const database = new DatabaseSync(file);
  database.exec("CREATE TABLE ItemTable (key TEXT UNIQUE, value TEXT)");
  const insert = database.prepare("INSERT INTO ItemTable VALUES (?, ?)");
  insert.run("Anthropic.claude-code", JSON.stringify({ "sessionUnread:/work": ["session-a"] }));
  insert.run("unrelated.extension", JSON.stringify({ excluded: true }));
  database.close();
  const before = fs.readFileSync(file);
  try {
    const reader = new ProviderStateReader();
    assert.equal(reader.supported, true);
    assert.deepEqual(reader.read(file, ["anthropic.claude-code"]), { "anthropic.claude-code": { "sessionUnread:/work": ["session-a"] } });
    assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(reader.read(path.join(folder, "missing.vscdb"), ["anthropic.claude-code"]), undefined);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
