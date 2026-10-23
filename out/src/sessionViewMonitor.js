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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionViewMonitor = void 0;
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const floatingState_1 = require("./floatingState");
const providerStateReader_1 = require("./providerStateReader");
const sessionSelection_1 = require("./sessionSelection");
class SessionViewMonitor {
    sessions;
    acknowledge;
    reader = new providerStateReader_1.ProviderStateReader();
    nativeReads = new sessionSelection_1.ClaudeReadTracker();
    codexReads = new sessionSelection_1.NativeReadTracker("codex");
    subscriptions = [];
    workspaceDatabase;
    globalDatabase;
    timer;
    selectedTab;
    selectionAt = 0;
    selectionResults = new Map();
    acknowledged = new Set();
    selectionTimer;
    lastError = "";
    selectedSessionId = "";
    acknowledgements = 0;
    codexReadStateAvailable = false;
    lastViewed;
    constructor(context, sessions, acknowledge) {
        this.sessions = sessions;
        this.acknowledge = acknowledge;
        this.workspaceDatabase = context.storageUri?.scheme === "file" ? path.join(path.dirname(context.storageUri.fsPath), "state.vscdb") : undefined;
        this.globalDatabase = path.join(path.dirname(context.globalStorageUri.fsPath), "state.vscdb");
        this.selectedTab = vscode.window.tabGroups.activeTabGroup.activeTab;
        this.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => this.selectionChanged()), vscode.window.tabGroups.onDidChangeTabGroups(() => this.selectionChanged()), vscode.window.onDidChangeWindowState((state) => { if (state.focused)
            this.schedule(); }));
        this.poll();
        this.timer = setInterval(() => this.poll(), 1000);
    }
    dispose() {
        clearInterval(this.timer);
        if (this.selectionTimer)
            clearTimeout(this.selectionTimer);
        for (const subscription of this.subscriptions)
            subscription.dispose();
    }
    getDiagnostics() {
        return { sqliteSupported: this.reader.supported, selectedSessionId: this.selectedSessionId, acknowledgements: this.acknowledgements,
            codexReadStateAvailable: this.codexReadStateAvailable, lastViewed: this.lastViewed, lastError: this.lastError };
    }
    confirms(session) {
        if (!vscode.window.state.focused)
            return false;
        if (session.provider === "codex")
            return this.acknowledged.has((0, floatingState_1.acknowledgementKey)(session));
        try {
            return this.activeClaudeSession() === session.sessionId;
        }
        catch (error) {
            this.lastError = String(error);
            return false;
        }
    }
    workspacePaths() {
        // Claude scopes native unread state to the first workspace folder.
        return (vscode.workspace.workspaceFolders ?? []).slice(0, 1).map((folder) => folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path);
    }
    activeClaudeSession() {
        const group = vscode.window.tabGroups.activeTabGroup;
        const active = group.activeTab;
        if (!active || !(active.input instanceof vscode.TabInputWebview) || !active.input.viewType.includes("claudeVSCodePanel"))
            return;
        const state = this.reader.read(this.workspaceDatabase, ["memento/workbench.parts.editor", "Anthropic.claude-code"]);
        if (!state)
            return;
        return (0, sessionSelection_1.selectedClaudeSession)(state["memento/workbench.parts.editor"], state["Anthropic.claude-code"], {
            selected: group.tabs.indexOf(active), tabs: group.tabs.map((tab) => ({ label: tab.label,
                viewType: tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : undefined })),
        });
    }
    selectionChanged() {
        const current = vscode.window.tabGroups.activeTabGroup.activeTab;
        if (current !== this.selectedTab) {
            this.selectedTab = current;
            this.selectionAt = vscode.window.state.focused ? Date.now() : 0;
            // Capture pending results at the click, before persistence catches up.
            // A result completing later must not inherit an earlier selection.
            this.selectionResults = new Map(this.sessions().filter((session) => (0, sessionSelection_1.isPendingResult)(session))
                .map((session) => [session.key, (0, sessionSelection_1.viewedResult)(session)]));
            this.schedule();
        }
    }
    schedule() {
        if (this.selectionTimer)
            clearTimeout(this.selectionTimer);
        this.selectionTimer = setTimeout(() => { this.selectionTimer = undefined; this.poll(); }, 150);
    }
    codexSession(tab) {
        const input = tab?.input;
        if (!(input instanceof vscode.TabInputCustom) || input.viewType !== "chatgpt.conversationEditor"
            || input.uri.scheme !== "openai-codex" || input.uri.authority !== "route")
            return;
        return /^\/(?:local|remote)\/([a-zA-Z0-9_-]+)$/.exec(input.uri.path)?.[1];
    }
    mark(result, source = "selected-editor") {
        if (this.acknowledged.has(result.acknowledgement))
            return;
        this.acknowledge(result);
        this.acknowledged.add(result.acknowledgement);
        this.acknowledgements += 1;
        const session = this.sessions().find((candidate) => candidate.key === result.key);
        if (session)
            this.lastViewed = { provider: session.provider, sessionId: session.sessionId, source };
    }
    poll() {
        try {
            const sessions = this.sessions();
            const global = this.reader.read(this.globalDatabase, ["Anthropic.claude-code", "openai.chatgpt"]);
            const unread = (0, sessionSelection_1.claudeUnread)(global?.["Anthropic.claude-code"], this.workspacePaths());
            for (const result of this.nativeReads.consume(unread, sessions))
                this.mark(result, "claude-native-read");
            const codexState = global?.["openai.chatgpt"];
            const codexPending = (0, sessionSelection_1.codexUnread)(codexState);
            this.codexReadStateAvailable = Boolean(codexPending);
            for (const result of this.codexReads.consume(codexPending, sessions))
                this.mark(result, "codex-native-read");
            if (!vscode.window.state.focused)
                return;
            const active = vscode.window.tabGroups.activeTabGroup.activeTab;
            const codexId = this.codexSession(active);
            const claudeId = codexId ? undefined : this.activeClaudeSession();
            const id = codexId ?? claudeId;
            this.selectedSessionId = id ?? "";
            if (!id)
                return;
            const session = (0, sessionSelection_1.matchingResult)(sessions, codexId ? "codex" : "claude", id);
            if (!(0, sessionSelection_1.isPendingResult)(session))
                return;
            const explicitlySelected = active === this.selectedTab && Date.now() - this.selectionAt < 70_000;
            // A window focus alone is insufficient. For an already-active Claude
            // panel, additionally require its provider's explicit persisted read state
            // and allow the provider's debounced storage update to finish.
            const nativeRead = Boolean(claudeId && unread && !unread.has(id) && Date.now() - session.updatedAt >= 7500);
            if (!explicitlySelected && !nativeRead)
                return;
            if (explicitlySelected) {
                const result = this.selectionResults.get(session.key);
                if (!result || !(0, sessionSelection_1.isPendingResult)(session, result))
                    return;
            }
            this.mark((0, sessionSelection_1.viewedResult)(session));
            this.lastError = "";
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
        }
    }
}
exports.SessionViewMonitor = SessionViewMonitor;
