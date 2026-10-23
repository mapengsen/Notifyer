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
  const routes: any[] = [], external: any[] = [];
  const extension = { extensionKind: 2, activate: async () => undefined,
    packageJSON: { contributes: { customEditors: [{ viewType: "chatgpt.conversationEditor" }] } } };
  const api: any = {
    ExtensionKind: { UI: 1, Workspace: 2 }, TabInputCustom, TabInputWebview,
    extensions: { getExtension: () => extension }, env: { remoteName: undefined, uriScheme: "vscode-test",
      asExternalUri: async (uri: any) => { routes.push(uri); return { ...uri, query: "windowId=test-window" }; },
      openExternal: async (uri: any) => { external.push(uri); return true; } },
    workspace: { workspaceFolders: [{ uri: { authority: "ssh-remote+server-a" } }] },
    Uri: { from: (value: unknown) => value, parse: (value: string) => ({ authority: new URL(value).host }) },
    window: { tabGroups: { activeTabGroup: { activeTab: undefined } } },
    commands: {
      getCommands: async () => ["claude-vscode.editor.open", "chatgpt.openSidebar"],
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
  const open = (module.exports as { openSession: (value: StoredSession, confirms?: (value: StoredSession) => boolean,
    report?: (details: any) => void) => Promise<boolean> }).openSession;
  return { api, extension, calls, routes, external, open };
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
  assert.equal(await n.open(remote, () => false), false);
});

test("Codex opens the exact conversation through its window-resolved sidebar URI without creating editor tabs", async () => {
  const n = navigator();
  const value = session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" });
  assert.equal(await n.open(value, (target) => target.sessionId === "session-a"), true);
  assert.deepEqual(n.routes.map((uri) => [uri.scheme, uri.authority, uri.path]),
    [["vscode-test", "openai.chatgpt", "/local/session-a"]]);
  assert.equal(n.external[0].query, "windowId=test-window");
  assert.deepEqual(n.calls, []);
});

test("accepted Codex URI delivery alone never proves that a result was read", async () => {
  const n = navigator(), diagnostics: any[] = [];
  assert.equal(await n.open(session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" }),
    () => false, (details) => diagnostics.push(details)), false);
  assert.equal(n.external.length, 1);
  assert.equal(diagnostics.at(-1).phase, "sidebar-open-requested");
});

test("unavailable sidebar commands and rejected URI delivery retain the reminder without opening an editor", async () => {
  const n = navigator(), value = session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" });
  n.api.commands.getCommands = async () => [];
  assert.equal(await n.open(value), false);
  assert.equal(n.external.length, 0);
  n.api.commands.getCommands = async () => ["chatgpt.openSidebar"];
  n.api.env.openExternal = async () => false;
  assert.equal(await n.open(value, () => true), false);
  assert.deepEqual(n.calls, []);
});

test("Remote SSH Claude commands work when the provider is absent from the UI extension host registry", async () => {
  const n = navigator();
  n.api.env.remoteName = "ssh-remote";
  n.api.extensions.getExtension = () => undefined; // Actual Remote SSH topology.
  const value = session({ key: "claude:vscode-remote://ssh-remote+server-a/root/a.jsonl:session-a" });
  const f = fixture(value);
  const diagnostics: any[] = [];
  f.focus();
  f.host.openSession = (target) => n.open(target, () => n.calls.at(-1)?.args[0] === value.sessionId,
    (details) => diagnostics.push(details));
  assert.equal(await focusSession(request(value), f.host), "viewed");
  assert.deepEqual(f.read, [acknowledgementKey(value)]);
  assert.equal(n.calls.length, 1);
  assert.equal(n.calls[0].command, "claude-vscode.editor.open");
  assert.equal(n.calls[0].args[0], value.sessionId);
  assert.equal(diagnostics.at(-1).localExtensionVisible, false);
  assert.equal(diagnostics.at(-1).phase, "session-id-confirmed");
});

test("remote providers with unavailable commands or the wrong SSH authority remain unread", async () => {
  const n = navigator();
  n.api.env.remoteName = "ssh-remote";
  n.api.extensions.getExtension = () => undefined;
  n.api.commands.getCommands = async () => [];
  const remote = session({ key: "claude:vscode-remote://ssh-remote+server-a/root/a.jsonl:session-a" });
  const diagnostics: any[] = [];
  assert.equal(await n.open(remote, () => true, (details) => diagnostics.push(details)), false);
  assert.equal(diagnostics.at(-1).phase, "selector-unavailable");
  assert.equal(await n.open({ ...remote, key: remote.key.replace("server-a", "server-b") }, () => true,
    (details) => diagnostics.push(details)), false);
  assert.equal(diagnostics.at(-1).phase, "remote-authority-mismatch");
  assert.deepEqual(n.calls, []);
});

test("a changed provider tab cannot bypass a supplied session-ID verifier", async () => {
  const n = navigator();
  assert.equal(await n.open(session(), () => false), false);
  assert.equal(n.calls.length, 1);
});

test("Remote Codex sidebar routes work without same-host provider metadata and reject a different SSH host", async () => {
  const n = navigator();
  n.api.env.remoteName = "ssh-remote";
  n.api.extensions.getExtension = () => undefined;
  const remote = session({ provider: "codex", key: "codex:vscode-remote://ssh-remote+server-a/root/a.jsonl:session-a" });
  assert.equal(await n.open(remote, () => true), true);
  assert.equal(n.routes[0].path, "/local/session-a");
  assert.equal(n.external[0].query, "windowId=test-window");
  assert.equal(await n.open({ ...remote, key: remote.key.replace("server-a", "server-b") }, () => true), false);
  assert.equal(n.external.length, 1);
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
