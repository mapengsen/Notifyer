import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import test from "node:test";
import { StoredSession } from "../floatingState";
import { ViewedResult } from "../sessionSelection";

function monitorFixture(initialUnread: readonly string[] = ["session-a", "session-b"]) {
  const { DatabaseSync } = require("node:sqlite");
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-view-monitor-"));
  const globalStorage = path.join(folder, "globalStorage", "notifyer");
  const workspaceStorage = path.join(folder, "workspaceStorage", "workspace", "notifyer");
  fs.mkdirSync(globalStorage, { recursive: true });
  fs.mkdirSync(workspaceStorage, { recursive: true });
  function write(file: string, values: Record<string, unknown>) {
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE, value TEXT)");
    const insert = db.prepare("INSERT OR REPLACE INTO ItemTable VALUES (?, ?)");
    for (const [key, value] of Object.entries(values)) insert.run(key, JSON.stringify(value));
    db.close();
  }
  const names = ["session-a", "session-b"];
  const labels = ["First conversation", "Second conversation"];
  const viewType = "mainThreadWebview-claudeVSCodePanel";
  const clock = 1_800_000_000_000;
  let sessions: StoredSession[] = names.map((id) => ({ key: `claude:file:///work/${id}.jsonl:${id}`, provider: "claude", sessionId: id,
    turnId: "turn-a", cwd: "/work", title: "prompt", status: "completed", startedAt: clock - 20_000,
    updatedAt: clock - 10_000, unread: true, live: true }));
  const globalFile = path.join(path.dirname(globalStorage), "state.vscdb");
  const workspaceFile = path.join(path.dirname(workspaceStorage), "state.vscdb");
  const setUnread = (ids: string[]) => write(globalFile, { "Anthropic.claude-code": { "sessionUnread:/work": ids } });
  setUnread([...initialUnread]);
  write(workspaceFile, {
    "Anthropic.claude-code": { panelTabSessions: names.map((sessionId, index) => ({ sessionId, title: labels[index] })) },
    "memento/workbench.parts.editor": { "editorpart.state": { serializedGrid: { root: { type: "leaf", data: { editors: names.map((sessionID, index) => ({
      id: "workbench.editors.webviewInput", value: JSON.stringify({ viewType, extensionId: "Anthropic.claude-code", title: labels[index], state: { sessionID } }),
    })) } } } } },
  });
  class TabInputWebview { constructor(public viewType: string) {} }
  class TabInputCustom { constructor(public uri: unknown, public viewType: string) {} }
  const tabs = labels.map((label) => ({ label, input: new TabInputWebview(viewType) }));
  const group: any = { tabs, activeTab: tabs[0] };
  let tabsChanged = () => {};
  let windowChanged = (_: { focused: boolean }) => {};
  let interval = () => {};
  let scheduled: (() => void) | undefined;
  const dispose = () => ({ dispose() {} });
  const api: any = { TabInputWebview, TabInputCustom,
    window: { state: { focused: false }, tabGroups: { activeTabGroup: group,
      onDidChangeTabs: (callback: () => void) => { tabsChanged = callback; return dispose(); },
      onDidChangeTabGroups: dispose },
      onDidChangeWindowState: (callback: typeof windowChanged) => { windowChanged = callback; return dispose(); } },
    workspace: { workspaceFolders: [{ uri: { scheme: "file", fsPath: "/work" } }] },
  };
  const file = path.resolve(__dirname, "../sessionViewMonitor.js");
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { exports: module.exports, module,
    require: (name: string) => name === "vscode" ? api : localRequire(name), Date: { now: () => clock },
    setInterval: (callback: () => void) => { interval = callback; return 1; }, clearInterval() {},
    setTimeout: (callback: () => void) => { scheduled = callback; return 1; }, clearTimeout: () => { scheduled = undefined; },
  });
  const read: ViewedResult[] = [];
  const Monitor = (module.exports as any).SessionViewMonitor;
  const monitor = new Monitor({ storageUri: { scheme: "file", fsPath: workspaceStorage }, globalStorageUri: { fsPath: globalStorage } },
    () => sessions, (result: ViewedResult) => read.push(result));
  const flush = () => { const callback = scheduled; scheduled = undefined; callback?.(); };
  return { api, read, monitor, setUnread, flush,
    focus: () => { api.window.state.focused = true; windowChanged({ focused: true }); flush(); },
    select: (index: number) => { group.activeTab = tabs[index]; tabsChanged(); },
    selectCodex: (id: string) => {
      const tab = { label: "Codex conversation", input: new TabInputCustom({ scheme: "openai-codex", authority: "route", path: `/local/${id}` }, "chatgpt.conversationEditor") };
      group.tabs = [tab]; group.activeTab = tab; tabsChanged();
    },
    tick: () => interval(), replace: (index: number, changes: Partial<StoredSession>) => { sessions[index] = { ...sessions[index], ...changes }; },
    close: () => { monitor.dispose(); fs.rmSync(folder, { recursive: true, force: true }); },
  };
}

test("selecting a completed Claude tab inside VS Code clears only that result without a floating-card click", () => {
  const f = monitorFixture();
  try {
    f.focus();
    assert.equal(f.read.length, 0);
    f.select(1); f.flush();
    assert.deepEqual(f.read.map((result) => result.key), ["claude:file:///work/session-b.jsonl:session-b"]);
    f.tick();
    assert.equal(f.read.length, 1);
  } finally { f.close(); }
});

test("focusing the same VS Code window while a different conversation is active does not clear another pending result", () => {
  const f = monitorFixture();
  try {
    f.replace(1, { unread: false });
    f.select(1);
    f.focus();
    f.tick();
    assert.equal(f.read.length, 0);
  } finally { f.close(); }
});

test("an already-active Claude conversation synchronizes its provider's explicit read state", () => {
  const f = monitorFixture(["session-b"]);
  try {
    f.focus();
    assert.deepEqual(f.read.map((result) => result.key), ["claude:file:///work/session-a.jsonl:session-a"]);
  } finally { f.close(); }
});

test("manual Codex selection uses the exact custom-editor URI and leaves Claude results untouched", () => {
  const f = monitorFixture();
  try {
    f.replace(1, { provider: "codex", key: "codex:file:///work/session-b.jsonl:session-b" });
    f.focus();
    f.selectCodex("session-b"); f.flush();
    assert.deepEqual(f.read.map((result) => result.key), ["codex:file:///work/session-b.jsonl:session-b"]);
  } finally { f.close(); }
});

test("the active Claude session can be confirmed for a card click even when its editor was already active", () => {
  const f = monitorFixture();
  try {
    f.focus();
    assert.equal(f.monitor.confirms({ provider: "claude", sessionId: "session-a" }), true);
    assert.equal(f.monitor.confirms({ provider: "claude", sessionId: "session-b" }), false);
  } finally { f.close(); }
});

test("selection cannot clear a newer result that arrives before delayed selection verification", () => {
  const f = monitorFixture();
  try {
    f.focus();
    f.select(1);
    f.replace(1, { turnId: "new-turn", updatedAt: 1_800_000_000_000 });
    f.flush();
    assert.equal(f.read.length, 0);
  } finally { f.close(); }
});

test("background tab changes do not count as a user selecting an unread conversation", () => {
  const f = monitorFixture();
  try {
    f.select(1); f.flush(); // Window remains unfocused.
    f.focus(); f.tick();
    assert.equal(f.read.length, 0);
  } finally { f.close(); }
});

test("a changed completion status during verification stays pending", () => {
  const f = monitorFixture();
  try {
    f.focus(); f.select(1);
    f.replace(1, { status: "failed" }); f.flush();
    assert.equal(f.read.length, 0);
  } finally { f.close(); }
});

test("selecting a running conversation does not pre-acknowledge its future result", () => {
  const f = monitorFixture();
  try {
    f.replace(1, { unread: false, status: "running" });
    f.focus();
    f.select(1);
    f.replace(1, { unread: true, status: "completed" });
    f.flush();
    assert.equal(f.read.length, 0);
  } finally { f.close(); }
});

test("native read synchronization works while the sidebar or another surface holds focus, without clearing other sessions", () => {
  const f = monitorFixture();
  try {
    f.setUnread(["session-b"]);
    f.tick();
    assert.deepEqual(f.read.map((result) => result.key), ["claude:file:///work/session-a.jsonl:session-a"]);
  } finally { f.close(); }
});
