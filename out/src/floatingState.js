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
exports.panelVisibility = panelVisibility;
exports.isPanelHealthy = isPanelHealthy;
exports.digest = digest;
exports.acknowledgementKey = acknowledgementKey;
exports.applyActivity = applyActivity;
exports.atomicWriteJson = atomicWriteJson;
exports.aggregateSessions = aggregateSessions;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const sessionActivity_1 = require("./sessionActivity");
function panelVisibility(heartbeat, request, now = Date.now()) {
    // Reflect a click immediately, including clicks originating in another window.
    // The helper's acknowledgement takes over as soon as it consumes the request.
    if (request && request.id !== heartbeat?.controlId && ["show", "hide"].includes(request.type)
        && now - request.requestedAt >= -1000 && now - request.requestedAt < 10_000) {
        return request.type === "show";
    }
    return isPanelHealthy(heartbeat, now) && heartbeat.visible;
}
function isPanelHealthy(heartbeat, now = Date.now()) {
    // A hidden panel is healthy too: it must never be reopened by the watchdog.
    return Boolean(heartbeat && Number.isInteger(heartbeat.pid) && heartbeat.pid > 0
        && Number.isFinite(heartbeat.updatedAt) && now - heartbeat.updatedAt >= -1000
        && now - heartbeat.updatedAt < 15_000);
}
function digest(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function acknowledgementKey(session) {
    return digest(`${session.key}:${session.turnId}`);
}
function applyActivity(previous, incoming) {
    if (previous && (incoming.observedAt ?? incoming.updatedAt) < (previous.observedAt ?? previous.updatedAt))
        return previous;
    const sameTurn = previous?.turnId === incoming.turnId;
    return {
        ...incoming,
        unread: ["completed", "failed"].includes(incoming.status)
            && (sameTurn && previous?.status === incoming.status ? previous.unread : incoming.live),
    };
}
function atomicWriteJson(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    try {
        fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
        fs.renameSync(temporary, file);
    }
    finally {
        if (fs.existsSync(temporary))
            fs.unlinkSync(temporary);
    }
}
/** Deduplicate the same session observed by several windows; retain all owners. */
function aggregateSessions(snapshots, acknowledged, now = Date.now(), quietAfterMs = 30 * 60_000) {
    const grouped = new Map();
    for (const snapshot of snapshots) {
        const online = !snapshot.closed && now - snapshot.heartbeat < 15_000;
        for (const session of snapshot.sessions) {
            // Also hide control-command rows restored from an older extension host.
            if (session.provider === "claude" && (0, sessionActivity_1.isClaudeLocalCommandTitle)(session.title))
                continue;
            const old = grouped.get(session.key);
            const owner = { windowId: snapshot.windowId,
                label: snapshot.environment === "ssh-remote" ? snapshot.project : `${snapshot.project} · ${snapshot.environment}`, online };
            if (!old)
                grouped.set(session.key, { session, owners: [owner], online });
            else {
                old.owners.push(owner);
                old.online ||= online;
                const order = session.observedAt ?? session.updatedAt;
                const oldOrder = old.session.observedAt ?? old.session.updatedAt;
                if (order > oldOrder || (order === oldOrder && session.unread)) {
                    old.session = session;
                }
            }
        }
    }
    const rows = [];
    for (const { session, owners, online } of grouped.values()) {
        const acknowledgement = acknowledgementKey(session);
        const unread = session.unread && !acknowledged(acknowledgement);
        // Old viewed history is intentionally omitted; pending results remain visible.
        if (!unread && ["completed", "failed"].includes(session.status)
            && session.updatedAt < now - 24 * 60 * 60_000)
            continue;
        rows.push({
            ...session, unread, acknowledgement, owners: owners.sort((a, b) => Number(b.online) - Number(a.online)),
            status: session.status === "running" && (!session.live || !online || now - session.updatedAt > quietAfterMs) ? "unknown" : session.status,
        });
    }
    const priority = (item) => item.unread ? 0 : item.status === "running" ? 1 : item.status === "unknown" ? 2 : 3;
    return rows.sort((a, b) => priority(a) - priority(b) || b.updatedAt - a.updatedAt);
}
