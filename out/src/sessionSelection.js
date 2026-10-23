"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeReadTracker = exports.NativeReadTracker = void 0;
exports.selectedClaudeSession = selectedClaudeSession;
exports.claudeUnread = claudeUnread;
exports.codexUnread = codexUnread;
exports.viewedResult = viewedResult;
exports.matchingResult = matchingResult;
exports.isPendingResult = isPendingResult;
const floatingState_1 = require("./floatingState");
function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function decode(value) {
    try {
        return object(typeof value === "string" ? JSON.parse(value) : value);
    }
    catch {
        return {};
    }
}
const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
/** Bind the live tab position to serialized session IDs, never to prompt text. */
function selectedClaudeSession(editorState, providerState, live) {
    if (!Number.isInteger(live.selected) || live.selected < 0 || live.selected >= live.tabs.length)
        return;
    const groups = [];
    function collect(value, depth = 0) {
        if (depth > 20)
            return;
        const node = object(value);
        if (node.type === "leaf") {
            const group = object(node.data);
            if (Array.isArray(group.editors))
                groups.push(group);
        }
        else if (Array.isArray(node.data))
            for (const child of node.data)
                collect(child, depth + 1);
    }
    collect(object(object(decode(editorState)["editorpart.state"]).serializedGrid).root);
    const candidates = groups.filter((group) => {
        const editors = group.editors;
        return editors.length === live.tabs.length && editors.every((entry, index) => {
            const saved = decode(object(entry).value);
            return typeof saved.title === "string" && saved.title === live.tabs[index].label
                && typeof saved.viewType === "string" && saved.viewType === live.tabs[index].viewType;
        });
    });
    if (candidates.length !== 1)
        return;
    // Equal-looking tabs could have been reordered since the last persisted
    // snapshot. Ambiguous layouts are left unread until a reliable signal exists.
    const fingerprints = live.tabs.map((tab) => JSON.stringify([tab.viewType, tab.label]));
    if (new Set(fingerprints).size !== fingerprints.length)
        return;
    const saved = decode(object(candidates[0].editors[live.selected]).value);
    if (String(saved.extensionId).toLowerCase() !== "anthropic.claude-code"
        || !String(saved.viewType).includes("claudeVSCodePanel"))
        return;
    const sessionId = decode(saved.state).sessionID;
    if (typeof sessionId !== "string" || !sessionIdPattern.test(sessionId))
        return;
    const panels = decode(providerState).panelTabSessions;
    // Provider bindings update independently of workbench persistence. Requiring
    // both rejects a webview that has since been reused for a different session.
    if (!Array.isArray(panels) || !panels.some((panel) => object(panel).sessionId === sessionId && object(panel).title === saved.title))
        return;
    return sessionId;
}
function claudeUnread(globalState, workspacePaths) {
    const state = decode(globalState);
    const normalize = (value) => {
        const root = value.replace(/[\\/]+$/, "").replace(/[/\\]\.claude[/\\]worktrees[/\\][^/\\]+$/, "");
        return /^[a-z]:[/\\]/i.test(root) ? root.replace(/\\/g, "/").toLowerCase() : root;
    };
    const roots = new Set(workspacePaths.map(normalize));
    const matching = Object.entries(state).filter(([key, value]) => key.startsWith("sessionUnread:")
        && roots.has(normalize(key.slice("sessionUnread:".length))) && Array.isArray(value));
    if (!matching.length)
        return;
    const result = new Set();
    for (const [, entries] of matching)
        for (const entry of entries) {
            if (typeof entry === "string" && sessionIdPattern.test(entry))
                result.add(entry);
        }
    return result;
}
/** In the VS Code provider, "local" denotes the connected provider's execution environment. */
function codexUnread(globalState, hostId = "local") {
    const atoms = decode(decode(globalState)["persisted-atom-state"]);
    const entries = object(atoms["unread-thread-ids-by-host-v1"])[hostId];
    if (!Array.isArray(entries) || !entries.every((id) => typeof id === "string" && sessionIdPattern.test(id)))
        return;
    return new Set(entries);
}
function viewedResult(session) {
    return { key: session.key, turnId: session.turnId, acknowledgement: (0, floatingState_1.acknowledgementKey)(session), status: session.status };
}
function matchingResult(sessions, provider, sessionId) {
    const matches = sessions.filter((session) => session.provider === provider && session.sessionId === sessionId);
    return matches.length === 1 ? matches[0] : undefined;
}
function isPendingResult(session, result) {
    return Boolean(session?.unread && ["completed", "failed"].includes(session.status)
        && (!result || session.key === result.key && session.turnId === result.turnId && session.status === result.status
            && (0, floatingState_1.acknowledgementKey)(session) === result.acknowledgement));
}
/** Native read transitions are keyed by session; retain the observed turn too. */
class NativeReadTracker {
    provider;
    previous;
    constructor(provider) {
        this.provider = provider;
    }
    consume(unread, sessions) {
        if (!unread)
            return []; // Missing/corrupt state is never an empty unread list.
        const next = new Map();
        for (const id of unread) {
            const session = matchingResult(sessions, this.provider, id);
            next.set(id, this.previous?.get(id) ?? (isPendingResult(session) ? viewedResult(session) : undefined));
        }
        const results = [];
        for (const [id, observed] of this.previous ?? []) {
            if (next.has(id) || !observed)
                continue;
            const latest = matchingResult(sessions, this.provider, id);
            if (isPendingResult(latest, observed))
                results.push(observed);
        }
        this.previous = next;
        return results;
    }
}
exports.NativeReadTracker = NativeReadTracker;
class ClaudeReadTracker extends NativeReadTracker {
    constructor() { super("claude"); }
}
exports.ClaudeReadTracker = ClaudeReadTracker;
