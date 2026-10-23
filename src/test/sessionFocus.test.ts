import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vm from "node:vm";
import test from "node:test";
import { acknowledgementKey, StoredSession } from "../floatingState";
import { focusSession, SessionFocusHost, SessionFocusRequest } from "../sessionFocus";

function session(overrides: Partial<StoredSession> = {}): StoredSession {
  return { key: "claude:file:///C:/project/session.jsonl:session-a", provider: "claude", sessionId: "session-a",
    turnId: "turn-a", cwd: "C:/project", title: "同名对话", status: "completed", startedAt: 1000,
    updatedAt: 2000, live: true, unread: true, ...overrides };
}
function request(value: StoredSession): SessionFocusRequest {
  return { type: "focus", key: value.key, provider: value.provider, sessionId: value.sessionId,
    turnId: value.turnId, acknowledgement: acknowledgementKey(value) };
}
function fixture(value = session()) {
  let current = value;
  let focused = false;
  const opened: StoredSession[] = [];
  const read: string[] = [];
  const host: SessionFocusHost = {
    getSession: (key) => key === current.key ? current : undefined,
    focusWindow: async () => { focused = true; return true; },
    openSession: async (target) => { opened.push(target); return true; },
    isCurrentAndFocused: () => focused,
    acknowledge: (key) => { read.push(key); },
  };
  return { host, opened, read, value, replace: (next: StoredSession) => { current = next; }, focus: () => { focused = true; } };
}

test("opening the clicked completed conversation acknowledges only its exact result", async () => {
  const f = fixture();
  assert.equal(await focusSession(request(f.value), f.host), "viewed");
  assert.equal(f.opened[0].sessionId, "session-a");
  assert.deepEqual(f.read, [acknowledgementKey(f.value)]);
  assert.notEqual(f.read[0], acknowledgementKey(session({ key: "other-chat", sessionId: "session-b" })));
});

test("being in the same VS Code window with another conversation selected never clears a result", async () => {
  const f = fixture();
  f.focus();
  f.host.openSession = async () => false;
  assert.equal(await focusSession(request(f.value), f.host), "window-only");
  assert.deepEqual(f.read, []);
});

test("legacy window-only requests and mismatched session/turn identities cannot acknowledge anything", async () => {
  for (const change of [{ key: undefined }, { key: "other-chat" }, { sessionId: "other-chat" },
    { provider: "codex" }, { turnId: "new-turn" }, { acknowledgement: "a".repeat(64) }]) {
    const f = fixture();
    assert.equal(await focusSession({ ...request(f.value), ...change }, f.host), "window-only");
    assert.deepEqual(f.opened, []);
    assert.deepEqual(f.read, []);
  }
});

test("failed window activation does not open a chat or clear an unread result", async () => {
  const f = fixture();
  f.host.focusWindow = async () => false;
  assert.equal(await focusSession(request(f.value), f.host), "failed");
  assert.deepEqual(f.opened, []);
  assert.deepEqual(f.read, []);
});

test("provider errors keep the result unread", async () => {
  const f = fixture();
  f.host.openSession = async () => { throw new Error("restore failed"); };
  await assert.rejects(focusSession(request(f.value), f.host), /restore failed/);
  assert.deepEqual(f.read, []);
});

test("a new completed turn arriving during navigation remains unread", async () => {
  const f = fixture();
  f.host.openSession = async () => { f.replace(session({ turnId: "turn-b" })); return true; };
  assert.equal(await focusSession(request(f.value), f.host), "opened");
  assert.deepEqual(f.read, []);
});

test("a revised completion status arriving during navigation remains unread", async () => {
  const f = fixture();
  f.host.openSession = async () => { f.replace(session({ status: "failed" })); return true; };
  assert.equal(await focusSession(request(f.value), f.host), "opened");
  assert.deepEqual(f.read, []);
});

test("opening the specific failed result can acknowledge that failure", async () => {
  const f = fixture(session({ status: "failed" }));
  assert.equal(await focusSession(request(f.value), f.host), "viewed");
  assert.deepEqual(f.read, [acknowledgementKey(f.value)]);
});

test("opening a running conversation does not suppress its later completion", async () => {
  const f = fixture(session({ status: "running", unread: false }));
  f.host.openSession = async () => { f.replace(session()); return true; };
  assert.equal(await focusSession(request(f.value), f.host), "opened");
  assert.deepEqual(f.read, []);
});

test("a newer click or lost window focus while opening a session leaves it unread", async () => {
  const f = fixture();
  f.host.openSession = async () => { f.host.isCurrentAndFocused = () => false; return true; };
  assert.equal(await focusSession(request(f.value), f.host), "window-only");
  assert.deepEqual(f.read, []);
});

test("an unsafe or missing session identifier can only return to the window", async () => {
  for (const sessionId of ["", "a/b", "../other", "a?target=other"]) {
    const f = fixture(session({ sessionId }));
    assert.equal(await focusSession(request(f.value), f.host), "window-only");
    assert.deepEqual(f.opened, []);
    assert.deepEqual(f.read, []);
  }
});

// Run the actual compiled adapter with an isolated VS Code API. This checks the
// command contract and active resource without launching real user conversations.
function navigator() {
  class TabInputCustom { constructor(public uri: unknown, public viewType: string) {} }
  class TabInputWebview { constructor(public viewType: string) {} }
  const calls: Array<{ command: string; args: any[] }> = [];
  const extension = { extensionKind: 2, activate: async () => undefined,
    packageJSON: { contributes: { customEditors: [{ viewType: "chatgpt.conversationEditor" }] } } };
  const api: any = {
    ExtensionKind: { UI: 1, Workspace: 2 }, TabInputCustom, TabInputWebview,
    extensions: { getExtension: () => extension }, env: { remoteName: undefined },
    workspace: { workspaceFolders: [{ uri: { authority: "ssh-remote+server-a" } }] },
    Uri: { from: (value: unknown) => value, parse: (value: string) => ({ authority: new URL(value).host }) },
    window: { tabGroups: { activeTabGroup: { activeTab: undefined } } },
    commands: {
      getCommands: async () => ["claude-vscode.editor.open"],
      executeCommand: async (command: string, ...args: any[]) => {
        calls.push({ command, args });
        if (command === "vscode.openWith") api.window.tabGroups.activeTabGroup.activeTab = { input: new TabInputCustom(args[0], args[1]) };
        if (command === "claude-vscode.editor.open") api.window.tabGroups.activeTabGroup.activeTab = { input: new TabInputWebview("mainThreadWebview-claudeVSCodePanel") };
      },
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../sessionNavigator.js"), "utf8"),
    { exports: module.exports, module, setTimeout: (action: () => void) => action(),
      require: (name: string) => { assert.equal(name, "vscode"); return api; } });
  const open = (module.exports as { openSession: (value: StoredSession, confirms?: (value: StoredSession) => boolean) => Promise<boolean> }).openSession;
  return { api, extension, calls, open };
}

test("Claude navigation selects the requested session ID even when chat titles are identical", async () => {
  const n = navigator();
  assert.equal(await n.open(session()), true);
  assert.equal(await n.open(session({ sessionId: "session-b", key: "claude:file:///C:/project/b.jsonl:session-b" })), true);
  assert.deepEqual(n.calls.map((call) => [call.command, call.args[0]]),
    [["claude-vscode.editor.open", "session-a"], ["claude-vscode.editor.open", "session-b"]]);
  assert.equal(n.calls[0].args[4], true);
});

test("unsupported Claude commands never fall back to a generic sidebar or last conversation", async () => {
  const n = navigator();
  n.api.commands.getCommands = async () => ["claude-vscode.editor.openLast", "claude-vscode.sidebar.open"];
  assert.equal(await n.open(session()), false);
  assert.deepEqual(n.calls, []);
});

test("Claude does not clear pending results when only the window/sidebar is revealed or a different provider tab is selected", async () => {
  const n = navigator();
  await n.open(session());
  n.api.commands.executeCommand = async () => undefined;
  assert.equal(await n.open(session()), false);
  n.api.commands.executeCommand = async () => { n.api.window.tabGroups.activeTabGroup.activeTab = { input: new n.api.TabInputWebview("other-provider") }; };
  assert.equal(await n.open(session()), false);
});

test("validated session bindings confirm an already-active Claude editor without accepting another conversation", async () => {
  const n = navigator();
  await n.open(session());
  n.api.commands.executeCommand = async () => undefined;
  assert.equal(await n.open(session(), (target) => target.sessionId === "session-a"), true);
  assert.equal(await n.open(session({ sessionId: "session-b" }), (target) => target.sessionId === "session-a"), false);
});

test("a remote Claude session can use a validated binding even when extension host metadata describes the local UI", async () => {
  const n = navigator();
  n.api.env.remoteName = "ssh-remote";
  n.extension.extensionKind = 1;
  const remote = session({ key: "claude:vscode-remote://ssh-remote+server-a/home/a.jsonl:session-a" });
  assert.equal(await n.open(remote, (target) => target.sessionId === "session-a"), true);
  assert.equal(await n.open(remote), false);
});

test("Codex navigation verifies the active custom editor's exact session resource", async () => {
  const n = navigator();
  const value = session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" });
  assert.equal(await n.open(value), true);
  assert.equal(n.calls[0].command, "vscode.openWith");
  assert.equal(n.calls[0].args[0].path, "/local/session-a");
  assert.equal(n.calls[0].args[1], "chatgpt.conversationEditor");
  n.api.commands.executeCommand = async () => undefined; // It failed to select the requested chat.
  assert.equal(await n.open({ ...value, sessionId: "session-b", key: "codex:file:///C:/project/b.jsonl:session-b" }), false);
});

test("missing provider extensions and unsupported custom editors preserve the reminder", async () => {
  const n = navigator();
  n.extension.packageJSON.contributes.customEditors = [];
  assert.equal(await n.open(session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" })), false);
  n.api.extensions.getExtension = () => undefined;
  assert.equal(await n.open(session()), false);
  assert.deepEqual(n.calls, []);
});

test("remote navigation checks the provider environment and remote authority", async () => {
  const n = navigator();
  const remote = session({ key: "claude:vscode-remote://ssh-remote+server-a/home/a.jsonl:session-a" });
  assert.equal(await n.open(remote), false);
  n.api.env.remoteName = "ssh-remote";
  assert.equal(await n.open(session()), false); // A local log cannot identify a remote provider chat.
  assert.equal(await n.open(remote), true);
  assert.equal(await n.open({ ...remote, key: remote.key.replace("server-a", "server-b") }), false);
  assert.equal(n.calls.length, 1);
});
