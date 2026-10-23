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
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const floatingState_1 = require("../floatingState");
const providerStateReader_1 = require("../providerStateReader");
const sessionSelection_1 = require("../sessionSelection");
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
function session(id = "session-a", overrides = {}) {
    return { key: `claude:vscode-remote://ssh-remote+server/root/${id}.jsonl:${id}`, provider: "claude", sessionId: id,
        turnId: "turn-a", cwd: "/work", title: "same prompt", status: "completed", startedAt: 1000,
        updatedAt: 2000, unread: true, live: true, ...overrides };
}
(0, node_test_1.default)("manual Claude tab selection resolves each exact session ID in the same VS Code window", () => {
    const f = fixture();
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), "session-a");
    f.live.selected = 1;
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), "session-b");
});
(0, node_test_1.default)("selection follows the live active tab rather than the persisted most-recent tab", () => {
    const f = fixture();
    f.leaf.data.mru = [1, 0];
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), "session-a");
});
(0, node_test_1.default)("changed tab order, new tabs, reused sessions and unknown editor state preserve pending results", () => {
    const f = fixture();
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, { ...f.live, tabs: [...f.live.tabs].reverse() }), undefined);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, { ...f.live, tabs: [...f.live.tabs, f.live.tabs[0]] }), undefined);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, { panelTabSessions: [{ ...f.provider.panelTabSessions[0], sessionId: "reused-panel" }] }, f.live), undefined);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)({}, f.provider, f.live), undefined);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)("broken JSON", f.provider, f.live), undefined);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, { ...f.live, selected: -1 }), undefined);
});
(0, node_test_1.default)("identical-looking tabs and duplicate matching groups are ambiguous and never guessed", () => {
    const f = fixture();
    f.state["editorpart.state"].serializedGrid.root.data.push(f.leaf);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), undefined);
    f.state["editorpart.state"].serializedGrid.root.data.pop();
    f.provider.panelTabSessions[1].title = f.provider.panelTabSessions[0].title;
    f.live.tabs[1].label = f.live.tabs[0].label;
    const saved = JSON.parse(f.editors[1].value);
    saved.title = f.live.tabs[0].label;
    f.editors[1].value = JSON.stringify(saved);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), undefined);
});
(0, node_test_1.default)("another provider's webview and malformed session IDs cannot mark a Claude result read", () => {
    const f = fixture();
    const saved = JSON.parse(f.editors[0].value);
    saved.extensionId = "other.extension";
    f.editors[0].value = JSON.stringify(saved);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), undefined);
    saved.extensionId = "Anthropic.claude-code";
    saved.state = JSON.stringify({ sessionID: "../other" });
    f.editors[0].value = JSON.stringify(saved);
    strict_1.default.equal((0, sessionSelection_1.selectedClaudeSession)(f.state, f.provider, f.live), undefined);
});
(0, node_test_1.default)("Claude native read state is scoped to the exact workspace and missing state is unknown", () => {
    const state = { "sessionUnread:/work": ["session-a"], "sessionUnread:/other": ["session-b"], "sessionUnread:/invalid": "bad" };
    strict_1.default.deepEqual((0, sessionSelection_1.claudeUnread)(state, ["/work"]), new Set(["session-a"]));
    strict_1.default.deepEqual((0, sessionSelection_1.claudeUnread)(state, ["/work/"]), new Set(["session-a"]));
    strict_1.default.deepEqual((0, sessionSelection_1.claudeUnread)({ "sessionUnread:/work": [] }, ["/work/.claude/worktrees/topic"]), new Set());
    strict_1.default.equal((0, sessionSelection_1.claudeUnread)(state, ["/missing"]), undefined);
    strict_1.default.equal((0, sessionSelection_1.claudeUnread)(state, ["/invalid"]), undefined);
    strict_1.default.equal((0, sessionSelection_1.claudeUnread)(undefined, ["/work"]), undefined);
});
(0, node_test_1.default)("native read scopes normalize Windows path casing while keeping remote POSIX paths case-sensitive", () => {
    strict_1.default.deepEqual((0, sessionSelection_1.claudeUnread)({ "sessionUnread:C:\\Work\\Project": ["session-a"] }, ["c:/work/project/"]), new Set(["session-a"]));
    strict_1.default.equal((0, sessionSelection_1.claudeUnread)({ "sessionUnread:/Work/Project": [] }, ["/work/project"]), undefined);
});
(0, node_test_1.default)("a provider read transition removes only that session's pending turn", () => {
    const tracker = new sessionSelection_1.ClaudeReadTracker();
    const a = session(), b = session("session-b");
    strict_1.default.deepEqual(tracker.consume(new Set(["session-a", "session-b"]), [a, b]), []);
    strict_1.default.deepEqual(tracker.consume(new Set(["session-b"]), [a, b]), [(0, sessionSelection_1.viewedResult)(a)]);
    strict_1.default.deepEqual(tracker.consume(new Set(), [a, b]), [(0, sessionSelection_1.viewedResult)(b)]);
});
(0, node_test_1.default)("native read baseline, corrupt data and later completions never clear unrelated results", () => {
    const tracker = new sessionSelection_1.ClaudeReadTracker();
    const a = session();
    strict_1.default.deepEqual(tracker.consume(new Set(), [a]), []);
    strict_1.default.deepEqual(tracker.consume(new Set(["session-a"]), [a]), []);
    strict_1.default.deepEqual(tracker.consume(undefined, [a]), []);
    strict_1.default.deepEqual(tracker.consume(new Set(), [session("session-a", { turnId: "new-turn" })]), []);
    strict_1.default.deepEqual(tracker.consume(new Set(), [a]), []);
});
(0, node_test_1.default)("session and turn identities prevent reading duplicate sources or newer results", () => {
    const a = session(), result = (0, sessionSelection_1.viewedResult)(a);
    strict_1.default.equal((0, sessionSelection_1.matchingResult)([a, { ...a, key: "other-source" }], "claude", "session-a"), undefined);
    strict_1.default.equal((0, sessionSelection_1.matchingResult)([a], "codex", "session-a"), undefined);
    strict_1.default.equal((0, sessionSelection_1.isPendingResult)(a, result), true);
    strict_1.default.equal((0, sessionSelection_1.isPendingResult)({ ...a, turnId: "new-turn" }, result), false);
    strict_1.default.equal((0, sessionSelection_1.isPendingResult)({ ...a, status: "running" }, result), false);
    strict_1.default.equal((0, sessionSelection_1.isPendingResult)({ ...a, status: "failed" }, result), false);
    strict_1.default.equal(result.acknowledgement, (0, floatingState_1.acknowledgementKey)(a));
});
function codexState(ids = ["session-a", "session-b"]) {
    return { "persisted-atom-state": { "unread-thread-ids-by-host-v1": { local: ids, other: ["session-c"] } } };
}
const codexSession = (id = "session-a", changes = {}) => session(id, { provider: "codex", key: `codex:file:///work/${id}.jsonl:${id}`, ...changes });
(0, node_test_1.default)("Codex native unread state uses the exact execution host and rejects malformed/missing data", () => {
    strict_1.default.deepEqual((0, sessionSelection_1.codexUnread)(codexState()), new Set(["session-a", "session-b"]));
    strict_1.default.deepEqual((0, sessionSelection_1.codexUnread)(codexState(), "other"), new Set(["session-c"]));
    strict_1.default.deepEqual((0, sessionSelection_1.codexUnread)(codexState([])), new Set());
    strict_1.default.equal((0, sessionSelection_1.codexUnread)(codexState("bad")), undefined);
    strict_1.default.equal((0, sessionSelection_1.codexUnread)(codexState(["../invalid"])), undefined);
    strict_1.default.equal((0, sessionSelection_1.codexUnread)(codexState(), "missing"), undefined);
    strict_1.default.equal((0, sessionSelection_1.codexUnread)(undefined), undefined);
});
(0, node_test_1.default)("Codex sidebar read transitions acknowledge only the observed Codex result, not the same-ID Claude result", () => {
    const tracker = new sessionSelection_1.NativeReadTracker("codex");
    const a = codexSession(), b = codexSession("session-b"), claude = session();
    strict_1.default.deepEqual(tracker.consume((0, sessionSelection_1.codexUnread)(codexState()), [a, b, claude]), []);
    strict_1.default.deepEqual(tracker.consume((0, sessionSelection_1.codexUnread)(codexState(["session-b"])), [a, b, claude]), [(0, sessionSelection_1.viewedResult)(a)]);
});
(0, node_test_1.default)("Codex native read transitions preserve a newer turn, revised status, ambiguous source and unread baseline", () => {
    for (const changed of [codexSession("session-a", { turnId: "new-turn" }), codexSession("session-a", { status: "failed" })]) {
        const tracker = new sessionSelection_1.NativeReadTracker("codex");
        tracker.consume(new Set(["session-a"]), [codexSession()]);
        strict_1.default.deepEqual(tracker.consume(new Set(), [changed]), []);
    }
    const tracker = new sessionSelection_1.NativeReadTracker("codex"), a = codexSession();
    strict_1.default.deepEqual(tracker.consume(new Set(), [a]), []);
    tracker.consume(new Set(["session-a"]), [a, { ...a, key: "copied-source" }]);
    strict_1.default.deepEqual(tracker.consume(new Set(), [a]), []);
});
(0, node_test_1.default)("provider storage reader uses readonly SQLite and reads only named namespaces, case-insensitively", () => {
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
        const reader = new providerStateReader_1.ProviderStateReader();
        strict_1.default.equal(reader.supported, true);
        strict_1.default.deepEqual(reader.read(file, ["anthropic.claude-code"]), { "anthropic.claude-code": { "sessionUnread:/work": ["session-a"] } });
        strict_1.default.deepEqual(fs.readFileSync(file), before);
        strict_1.default.equal(reader.read(path.join(folder, "missing.vscdb"), ["anthropic.claude-code"]), undefined);
    }
    finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
