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
const node_module_1 = require("node:module");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vm = __importStar(require("node:vm"));
const node_test_1 = __importDefault(require("node:test"));
function monitorFixture(initialUnread = ["session-a", "session-b"]) {
    const { DatabaseSync } = require("node:sqlite");
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-view-monitor-"));
    const globalStorage = path.join(folder, "globalStorage", "notifyer");
    const workspaceStorage = path.join(folder, "workspaceStorage", "workspace", "notifyer");
    fs.mkdirSync(globalStorage, { recursive: true });
    fs.mkdirSync(workspaceStorage, { recursive: true });
    function write(file, values) {
        const db = new DatabaseSync(file);
        db.exec("CREATE TABLE IF NOT EXISTS ItemTable (key TEXT UNIQUE, value TEXT)");
        const insert = db.prepare("INSERT OR REPLACE INTO ItemTable VALUES (?, ?)");
        for (const [key, value] of Object.entries(values))
            insert.run(key, JSON.stringify(value));
        db.close();
    }
    const names = ["session-a", "session-b"];
    const labels = ["First conversation", "Second conversation"];
    const viewType = "mainThreadWebview-claudeVSCodePanel";
    const clock = 1_800_000_000_000;
    let sessions = names.map((id) => ({ key: `claude:file:///work/${id}.jsonl:${id}`, provider: "claude", sessionId: id,
        turnId: "turn-a", cwd: "/work", title: "prompt", status: "completed", startedAt: clock - 20_000,
        updatedAt: clock - 10_000, unread: true, live: true }));
    const globalFile = path.join(path.dirname(globalStorage), "state.vscdb");
    const workspaceFile = path.join(path.dirname(workspaceStorage), "state.vscdb");
    const setUnread = (ids) => write(globalFile, { "Anthropic.claude-code": { "sessionUnread:/work": ids } });
    setUnread([...initialUnread]);
    write(workspaceFile, {
        "Anthropic.claude-code": { panelTabSessions: names.map((sessionId, index) => ({ sessionId, title: labels[index] })) },
        "memento/workbench.parts.editor": { "editorpart.state": { serializedGrid: { root: { type: "leaf", data: { editors: names.map((sessionID, index) => ({
                                id: "workbench.editors.webviewInput", value: JSON.stringify({ viewType, extensionId: "Anthropic.claude-code", title: labels[index], state: { sessionID } }),
                            })) } } } } },
    });
    class TabInputWebview {
        viewType;
        constructor(viewType) {
            this.viewType = viewType;
        }
    }
    class TabInputCustom {
        uri;
        viewType;
        constructor(uri, viewType) {
            this.uri = uri;
            this.viewType = viewType;
        }
    }
    const tabs = labels.map((label) => ({ label, input: new TabInputWebview(viewType) }));
    const group = { tabs, activeTab: tabs[0] };
    let tabsChanged = () => { };
    let windowChanged = (_) => { };
    let interval = () => { };
    let scheduled;
    const dispose = () => ({ dispose() { } });
    const api = { TabInputWebview, TabInputCustom,
        window: { state: { focused: false }, tabGroups: { activeTabGroup: group,
                onDidChangeTabs: (callback) => { tabsChanged = callback; return dispose(); },
                onDidChangeTabGroups: dispose },
            onDidChangeWindowState: (callback) => { windowChanged = callback; return dispose(); } },
        workspace: { workspaceFolders: [{ uri: { scheme: "file", fsPath: "/work" } }] }, };
    const file = path.resolve(__dirname, "../sessionViewMonitor.js");
    const localRequire = (0, node_module_1.createRequire)(file);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { exports: module.exports, module,
        require: (name) => name === "vscode" ? api : localRequire(name), Date: { now: () => clock },
        setInterval: (callback) => { interval = callback; return 1; }, clearInterval() { },
        setTimeout: (callback) => { scheduled = callback; return 1; }, clearTimeout: () => { scheduled = undefined; }, });
    const read = [];
    const Monitor = module.exports.SessionViewMonitor;
    const monitor = new Monitor({ storageUri: { scheme: "file", fsPath: workspaceStorage }, globalStorageUri: { fsPath: globalStorage } }, () => sessions, (result) => read.push(result));
    const flush = () => { const callback = scheduled; scheduled = undefined; callback?.(); };
    return { api, read, monitor, setUnread, flush,
        setCodexState: (ids) => write(globalFile, { "openai.chatgpt": {
                "persisted-atom-state": { "unread-thread-ids-by-host-v1": { local: ids } },
            } }),
        focus: () => { api.window.state.focused = true; windowChanged({ focused: true }); flush(); },
        select: (index) => { group.activeTab = tabs[index]; tabsChanged(); },
        selectCodex: (id) => {
            const tab = { label: "Codex conversation", input: new TabInputCustom({ scheme: "openai-codex", authority: "route", path: `/local/${id}` }, "chatgpt.conversationEditor") };
            group.tabs = [tab];
            group.activeTab = tab;
            tabsChanged();
        },
        tick: () => interval(), replace: (index, changes) => { sessions[index] = { ...sessions[index], ...changes }; },
        close: () => { monitor.dispose(); fs.rmSync(folder, { recursive: true, force: true }); }, };
}
(0, node_test_1.default)("selecting a completed Claude tab inside VS Code clears only that result without a floating-card click", () => {
    const f = monitorFixture();
    try {
        f.focus();
        strict_1.default.equal(f.read.length, 0);
        f.select(1);
        f.flush();
        strict_1.default.deepEqual(f.read.map((result) => result.key), ["claude:file:///work/session-b.jsonl:session-b"]);
        f.tick();
        strict_1.default.equal(f.read.length, 1);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("focusing the same VS Code window while a different conversation is active does not clear another pending result", () => {
    const f = monitorFixture();
    try {
        f.replace(1, { unread: false });
        f.select(1);
        f.focus();
        f.tick();
        strict_1.default.equal(f.read.length, 0);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("an already-active Claude conversation synchronizes its provider's explicit read state", () => {
    const f = monitorFixture(["session-b"]);
    try {
        f.focus();
        strict_1.default.deepEqual(f.read.map((result) => result.key), ["claude:file:///work/session-a.jsonl:session-a"]);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("manual Codex selection uses the exact custom-editor URI and leaves Claude results untouched", () => {
    const f = monitorFixture();
    try {
        f.replace(1, { provider: "codex", key: "codex:file:///work/session-b.jsonl:session-b" });
        f.focus();
        f.selectCodex("session-b");
        f.flush();
        strict_1.default.deepEqual(f.read.map((result) => result.key), ["codex:file:///work/session-b.jsonl:session-b"]);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("the active Claude session can be confirmed for a card click even when its editor was already active", () => {
    const f = monitorFixture();
    try {
        f.focus();
        strict_1.default.equal(f.monitor.confirms({ provider: "claude", sessionId: "session-a" }), true);
        strict_1.default.equal(f.monitor.confirms({ provider: "claude", sessionId: "session-b" }), false);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("selection cannot clear a newer result that arrives before delayed selection verification", () => {
    const f = monitorFixture();
    try {
        f.focus();
        f.select(1);
        f.replace(1, { turnId: "new-turn", updatedAt: 1_800_000_000_000 });
        f.flush();
        strict_1.default.equal(f.read.length, 0);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("background tab changes do not count as a user selecting an unread conversation", () => {
    const f = monitorFixture();
    try {
        f.select(1);
        f.flush(); // Window remains unfocused.
        f.focus();
        f.tick();
        strict_1.default.equal(f.read.length, 0);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("a changed completion status during verification stays pending", () => {
    const f = monitorFixture();
    try {
        f.focus();
        f.select(1);
        f.replace(1, { status: "failed" });
        f.flush();
        strict_1.default.equal(f.read.length, 0);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("selecting a running conversation does not pre-acknowledge its future result", () => {
    const f = monitorFixture();
    try {
        f.replace(1, { unread: false, status: "running" });
        f.focus();
        f.select(1);
        f.replace(1, { unread: true, status: "completed" });
        f.flush();
        strict_1.default.equal(f.read.length, 0);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("native read synchronization works while the sidebar or another surface holds focus, without clearing other sessions", () => {
    const f = monitorFixture();
    try {
        f.setUnread(["session-b"]);
        f.tick();
        strict_1.default.deepEqual(f.read.map((result) => result.key), ["claude:file:///work/session-a.jsonl:session-a"]);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("reading a completed Codex sidebar conversation clears only that result without a custom-editor tab change", () => {
    const f = monitorFixture();
    try {
        for (const index of [0, 1])
            f.replace(index, { provider: "codex", key: `codex:file:///work/session-${index ? "b" : "a"}.jsonl:session-${index ? "b" : "a"}` });
        f.setCodexState(["session-a", "session-b"]);
        f.tick();
        f.setCodexState(["session-b"]);
        f.tick();
        strict_1.default.deepEqual(f.read.map((result) => result.key), ["codex:file:///work/session-a.jsonl:session-a"]);
        strict_1.default.equal(f.monitor.getDiagnostics().codexReadStateAvailable, true);
        strict_1.default.equal(f.monitor.getDiagnostics().lastViewed.source, "codex-native-read");
        f.focus();
        const target = { provider: "codex", key: "codex:file:///work/session-a.jsonl:session-a", sessionId: "session-a", turnId: "turn-a" };
        strict_1.default.equal(f.monitor.confirms(target), true);
        strict_1.default.equal(f.monitor.confirms({ ...target, turnId: "later-result" }), false);
        strict_1.default.equal(f.monitor.confirms({ ...target, key: "codex:file:///work/session-b.jsonl:session-b", sessionId: "session-b" }), false);
        f.tick();
        strict_1.default.equal(f.read.length, 1);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("unavailable Codex read state and a later completion never consume another turn's read signal", () => {
    const f = monitorFixture();
    try {
        f.replace(1, { provider: "codex", key: "codex:file:///work/session-b.jsonl:session-b" });
        f.setCodexState(["session-b"]);
        f.tick();
        f.setCodexState("corrupt");
        f.tick();
        strict_1.default.equal(f.monitor.getDiagnostics().codexReadStateAvailable, false);
        f.replace(1, { turnId: "later-result", updatedAt: 1_800_000_000_000 });
        f.setCodexState([]);
        f.tick();
        strict_1.default.equal(f.read.length, 0);
    }
    finally {
        f.close();
    }
});
