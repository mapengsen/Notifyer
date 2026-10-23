"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vm = __importStar(require("node:vm"));
const node_test_1 = __importDefault(require("node:test"));
const floatingState_1 = require("../floatingState");
const sessionFocus_1 = require("../sessionFocus");
function session(overrides = {}) {
    return { key: "claude:file:///C:/project/session.jsonl:session-a", provider: "claude", sessionId: "session-a",
        turnId: "turn-a", cwd: "C:/project", title: "同名对话", status: "completed", startedAt: 1000,
        updatedAt: 2000, live: true, unread: true, ...overrides };
}
function request(value) {
    return { type: "focus", key: value.key, provider: value.provider, sessionId: value.sessionId,
        turnId: value.turnId, acknowledgement: (0, floatingState_1.acknowledgementKey)(value) };
}
function fixture(value = session()) {
    let current = value;
    let focused = false;
    const opened = [];
    const read = [];
    const host = {
        getSession: (key) => key === current.key ? current : undefined,
        focusWindow: async () => { focused = true; return true; },
        openSession: async (target) => { opened.push(target); return true; },
        isCurrentAndFocused: () => focused,
        acknowledge: (key) => { read.push(key); },
    };
    return { host, opened, read, value, replace: (next) => { current = next; }, focus: () => { focused = true; } };
}
(0, node_test_1.default)("opening the clicked completed conversation acknowledges only its exact result", async () => {
    const f = fixture();
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "viewed");
    strict_1.default.equal(f.opened[0].sessionId, "session-a");
    strict_1.default.deepEqual(f.read, [(0, floatingState_1.acknowledgementKey)(f.value)]);
    strict_1.default.notEqual(f.read[0], (0, floatingState_1.acknowledgementKey)(session({ key: "other-chat", sessionId: "session-b" })));
});
(0, node_test_1.default)("being in the same VS Code window with another conversation selected never clears a result", async () => {
    const f = fixture();
    f.focus();
    f.host.openSession = async () => false;
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "window-only");
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("legacy window-only requests and mismatched session/turn identities cannot acknowledge anything", async () => {
    for (const change of [{ key: undefined }, { key: "other-chat" }, { sessionId: "other-chat" },
        { provider: "codex" }, { turnId: "new-turn" }, { acknowledgement: "a".repeat(64) }]) {
        const f = fixture();
        strict_1.default.equal(await (0, sessionFocus_1.focusSession)({ ...request(f.value), ...change }, f.host), "window-only");
        strict_1.default.deepEqual(f.opened, []);
        strict_1.default.deepEqual(f.read, []);
    }
});
(0, node_test_1.default)("failed window activation does not open a chat or clear an unread result", async () => {
    const f = fixture();
    f.host.focusWindow = async () => false;
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "failed");
    strict_1.default.deepEqual(f.opened, []);
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("provider errors keep the result unread", async () => {
    const f = fixture();
    f.host.openSession = async () => { throw new Error("restore failed"); };
    await strict_1.default.rejects((0, sessionFocus_1.focusSession)(request(f.value), f.host), /restore failed/);
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("a new completed turn arriving during navigation remains unread", async () => {
    const f = fixture();
    f.host.openSession = async () => { f.replace(session({ turnId: "turn-b" })); return true; };
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "opened");
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("a revised completion status arriving during navigation remains unread", async () => {
    const f = fixture();
    f.host.openSession = async () => { f.replace(session({ status: "failed" })); return true; };
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "opened");
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("opening the specific failed result can acknowledge that failure", async () => {
    const f = fixture(session({ status: "failed" }));
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "viewed");
    strict_1.default.deepEqual(f.read, [(0, floatingState_1.acknowledgementKey)(f.value)]);
});
(0, node_test_1.default)("opening a running conversation does not suppress its later completion", async () => {
    const f = fixture(session({ status: "running", unread: false }));
    f.host.openSession = async () => { f.replace(session()); return true; };
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "opened");
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("a newer click or lost window focus while opening a session leaves it unread", async () => {
    const f = fixture();
    f.host.openSession = async () => { f.host.isCurrentAndFocused = () => false; return true; };
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "window-only");
    strict_1.default.deepEqual(f.read, []);
});
(0, node_test_1.default)("an unsafe or missing session identifier can only return to the window", async () => {
    for (const sessionId of ["", "a/b", "../other", "a?target=other"]) {
        const f = fixture(session({ sessionId }));
        strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(f.value), f.host), "window-only");
        strict_1.default.deepEqual(f.opened, []);
        strict_1.default.deepEqual(f.read, []);
    }
});
// Run the actual compiled adapter with an isolated VS Code API. This checks the
// command contract and active resource without launching real user conversations.
function navigator() {
    class TabInputCustom {
        uri;
        viewType;
        constructor(uri, viewType) {
            this.uri = uri;
            this.viewType = viewType;
        }
    }
    class TabInputWebview {
        viewType;
        constructor(viewType) {
            this.viewType = viewType;
        }
    }
    const calls = [];
    const routes = [], external = [];
    const extension = { extensionKind: 2, activate: async () => undefined,
        packageJSON: { contributes: { customEditors: [{ viewType: "chatgpt.conversationEditor" }] } } };
    const api = {
        ExtensionKind: { UI: 1, Workspace: 2 }, TabInputCustom, TabInputWebview,
        extensions: { getExtension: () => extension }, env: { remoteName: undefined, uriScheme: "vscode-test",
            asExternalUri: async (uri) => { routes.push(uri); return { ...uri, query: "windowId=test-window" }; },
            openExternal: async (uri) => { external.push(uri); return true; } },
        workspace: { workspaceFolders: [{ uri: { authority: "ssh-remote+server-a" } }] },
        Uri: { from: (value) => value, parse: (value) => ({ authority: new URL(value).host }) },
        window: { tabGroups: { activeTabGroup: { activeTab: undefined } } },
        commands: {
            getCommands: async () => ["claude-vscode.editor.open", "chatgpt.openSidebar"],
            executeCommand: async (command, ...args) => {
                calls.push({ command, args });
                if (command === "vscode.openWith")
                    api.window.tabGroups.activeTabGroup.activeTab = { input: new TabInputCustom(args[0], args[1]) };
                if (command === "claude-vscode.editor.open")
                    api.window.tabGroups.activeTabGroup.activeTab = { input: new TabInputWebview("mainThreadWebview-claudeVSCodePanel") };
            },
        },
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../sessionNavigator.js"), "utf8"), { exports: module.exports, module, setTimeout: (action) => action(),
        require: (name) => { strict_1.default.equal(name, "vscode"); return api; } });
    const open = module.exports.openSession;
    return { api, extension, calls, routes, external, open };
}
(0, node_test_1.default)("Claude navigation selects the requested session ID even when chat titles are identical", async () => {
    const n = navigator();
    strict_1.default.equal(await n.open(session()), true);
    strict_1.default.equal(await n.open(session({ sessionId: "session-b", key: "claude:file:///C:/project/b.jsonl:session-b" })), true);
    strict_1.default.deepEqual(n.calls.map((call) => [call.command, call.args[0]]), [["claude-vscode.editor.open", "session-a"], ["claude-vscode.editor.open", "session-b"]]);
    strict_1.default.equal(n.calls[0].args[4], true);
});
(0, node_test_1.default)("unsupported Claude commands never fall back to a generic sidebar or last conversation", async () => {
    const n = navigator();
    n.api.commands.getCommands = async () => ["claude-vscode.editor.openLast", "claude-vscode.sidebar.open"];
    strict_1.default.equal(await n.open(session()), false);
    strict_1.default.deepEqual(n.calls, []);
});
(0, node_test_1.default)("Claude does not clear pending results when only the window/sidebar is revealed or a different provider tab is selected", async () => {
    const n = navigator();
    await n.open(session());
    n.api.commands.executeCommand = async () => undefined;
    strict_1.default.equal(await n.open(session()), false);
    n.api.commands.executeCommand = async () => { n.api.window.tabGroups.activeTabGroup.activeTab = { input: new n.api.TabInputWebview("other-provider") }; };
    strict_1.default.equal(await n.open(session()), false);
});
(0, node_test_1.default)("validated session bindings confirm an already-active Claude editor without accepting another conversation", async () => {
    const n = navigator();
    await n.open(session());
    n.api.commands.executeCommand = async () => undefined;
    strict_1.default.equal(await n.open(session(), (target) => target.sessionId === "session-a"), true);
    strict_1.default.equal(await n.open(session({ sessionId: "session-b" }), (target) => target.sessionId === "session-a"), false);
});
(0, node_test_1.default)("a remote Claude session can use a validated binding even when extension host metadata describes the local UI", async () => {
    const n = navigator();
    n.api.env.remoteName = "ssh-remote";
    n.extension.extensionKind = 1;
    const remote = session({ key: "claude:vscode-remote://ssh-remote+server-a/home/a.jsonl:session-a" });
    strict_1.default.equal(await n.open(remote, (target) => target.sessionId === "session-a"), true);
    strict_1.default.equal(await n.open(remote, () => false), false);
});
(0, node_test_1.default)("Codex opens the exact conversation through its window-resolved sidebar URI without creating editor tabs", async () => {
    const n = navigator();
    const value = session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" });
    strict_1.default.equal(await n.open(value, (target) => target.sessionId === "session-a"), true);
    strict_1.default.deepEqual(n.routes.map((uri) => [uri.scheme, uri.authority, uri.path]), [["vscode-test", "openai.chatgpt", "/local/session-a"]]);
    strict_1.default.equal(n.external[0].query, "windowId=test-window");
    strict_1.default.deepEqual(n.calls, []);
});
(0, node_test_1.default)("accepted Codex URI delivery alone never proves that a result was read", async () => {
    const n = navigator(), diagnostics = [];
    strict_1.default.equal(await n.open(session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" }), () => false, (details) => diagnostics.push(details)), false);
    strict_1.default.equal(n.external.length, 1);
    strict_1.default.equal(diagnostics.at(-1).phase, "sidebar-open-requested");
});
(0, node_test_1.default)("unavailable sidebar commands and rejected URI delivery retain the reminder without opening an editor", async () => {
    const n = navigator(), value = session({ provider: "codex", key: "codex:file:///C:/project/a.jsonl:session-a" });
    n.api.commands.getCommands = async () => [];
    strict_1.default.equal(await n.open(value), false);
    strict_1.default.equal(n.external.length, 0);
    n.api.commands.getCommands = async () => ["chatgpt.openSidebar"];
    n.api.env.openExternal = async () => false;
    strict_1.default.equal(await n.open(value, () => true), false);
    strict_1.default.deepEqual(n.calls, []);
});
(0, node_test_1.default)("Remote SSH Claude commands work when the provider is absent from the UI extension host registry", async () => {
    const n = navigator();
    n.api.env.remoteName = "ssh-remote";
    n.api.extensions.getExtension = () => undefined; // Actual Remote SSH topology.
    const value = session({ key: "claude:vscode-remote://ssh-remote+server-a/root/a.jsonl:session-a" });
    const f = fixture(value);
    const diagnostics = [];
    f.focus();
    f.host.openSession = (target) => n.open(target, () => n.calls.at(-1)?.args[0] === value.sessionId, (details) => diagnostics.push(details));
    strict_1.default.equal(await (0, sessionFocus_1.focusSession)(request(value), f.host), "viewed");
    strict_1.default.deepEqual(f.read, [(0, floatingState_1.acknowledgementKey)(value)]);
    strict_1.default.equal(n.calls.length, 1);
    strict_1.default.equal(n.calls[0].command, "claude-vscode.editor.open");
    strict_1.default.equal(n.calls[0].args[0], value.sessionId);
    strict_1.default.equal(diagnostics.at(-1).localExtensionVisible, false);
    strict_1.default.equal(diagnostics.at(-1).phase, "session-id-confirmed");
});
(0, node_test_1.default)("remote providers with unavailable commands or the wrong SSH authority remain unread", async () => {
    const n = navigator();
    n.api.env.remoteName = "ssh-remote";
    n.api.extensions.getExtension = () => undefined;
    n.api.commands.getCommands = async () => [];
    const remote = session({ key: "claude:vscode-remote://ssh-remote+server-a/root/a.jsonl:session-a" });
    const diagnostics = [];
    strict_1.default.equal(await n.open(remote, () => true, (details) => diagnostics.push(details)), false);
    strict_1.default.equal(diagnostics.at(-1).phase, "selector-unavailable");
    strict_1.default.equal(await n.open({ ...remote, key: remote.key.replace("server-a", "server-b") }, () => true, (details) => diagnostics.push(details)), false);
    strict_1.default.equal(diagnostics.at(-1).phase, "remote-authority-mismatch");
    strict_1.default.deepEqual(n.calls, []);
});
(0, node_test_1.default)("a changed provider tab cannot bypass a supplied session-ID verifier", async () => {
    const n = navigator();
    strict_1.default.equal(await n.open(session(), () => false), false);
    strict_1.default.equal(n.calls.length, 1);
});
(0, node_test_1.default)("Remote Codex sidebar routes work without same-host provider metadata and reject a different SSH host", async () => {
    const n = navigator();
    n.api.env.remoteName = "ssh-remote";
    n.api.extensions.getExtension = () => undefined;
    const remote = session({ provider: "codex", key: "codex:vscode-remote://ssh-remote+server-a/root/a.jsonl:session-a" });
    strict_1.default.equal(await n.open(remote, () => true), true);
    strict_1.default.equal(n.routes[0].path, "/local/session-a");
    strict_1.default.equal(n.external[0].query, "windowId=test-window");
    strict_1.default.equal(await n.open({ ...remote, key: remote.key.replace("server-a", "server-b") }, () => true), false);
    strict_1.default.equal(n.external.length, 1);
    strict_1.default.deepEqual(n.calls, []);
});
(0, node_test_1.default)("remote navigation checks the provider environment and remote authority", async () => {
    const n = navigator();
    const remote = session({ key: "claude:vscode-remote://ssh-remote+server-a/home/a.jsonl:session-a" });
    strict_1.default.equal(await n.open(remote), false);
    n.api.env.remoteName = "ssh-remote";
    strict_1.default.equal(await n.open(session()), false); // A local log cannot identify a remote provider chat.
    strict_1.default.equal(await n.open(remote), true);
    strict_1.default.equal(await n.open({ ...remote, key: remote.key.replace("server-a", "server-b") }), false);
    strict_1.default.equal(n.calls.length, 1);
});
