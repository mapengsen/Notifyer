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
exports.CodexSessionMonitor = void 0;
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const vscode = __importStar(require("vscode"));
const core_1 = require("./core");
const notify_1 = require("./notify");
const sessionActivity_1 = require("./sessionActivity");
class CodexSessionMonitor {
    onActivity;
    constructor(onActivity = () => { }) {
        this.onActivity = onActivity;
    }
    trackers = new Map();
    baselineFileSizes = new Map();
    processedEventIds = new Set();
    pollTimer;
    pollInFlight = false;
    sessionsRootUris = [];
    lastError = "";
    pollCount = 0;
    notificationCount = 0;
    skippedChildCount = 0;
    skippedWorkspaceCount = 0;
    skippedInitialScanCount = 0;
    lastCompletionEvent;
    async start() {
        await this.restart();
    }
    async restart() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        this.trackers.clear();
        this.baselineFileSizes.clear();
        this.processedEventIds.clear();
        this.sessionsRootUris = [];
        this.skippedChildCount = 0;
        this.skippedWorkspaceCount = 0;
        this.skippedInitialScanCount = 0;
        this.lastCompletionEvent = undefined;
        await this.poll(false);
        this.pollTimer = setInterval(() => void this.poll(true), this.getPollMs());
    }
    getDiagnostics() {
        return {
            running: Boolean(this.pollTimer),
            sessionsRoot: this.sessionsRootUris[0]?.toString() ?? "",
            sessionsRoots: this.sessionsRootUris.map((root) => root.toString()),
            trackedFileCount: this.trackers.size,
            processedEventCount: this.processedEventIds.size,
            pollCount: this.pollCount,
            notificationCount: this.notificationCount,
            skippedChildCount: this.skippedChildCount,
            skippedWorkspaceCount: this.skippedWorkspaceCount,
            skippedInitialScanCount: this.skippedInitialScanCount,
            lastCompletionEvent: this.lastCompletionEvent,
            lastError: this.lastError,
        };
    }
    dispose() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
    }
    async poll(emitNotifications) {
        if (this.pollInFlight || !this.isEnabled())
            return;
        this.pollInFlight = true;
        this.pollCount += 1;
        try {
            if (!this.sessionsRootUris.length) {
                this.sessionsRootUris = await resolveSessionsRootUris();
            }
            if (!this.sessionsRootUris.length)
                return;
            const seenFiles = new Set();
            for (const root of this.sessionsRootUris) {
                const files = await collectRecentSessionFiles(root, this.getLookbackDays(), (uri, size, recent) => {
                    const key = uri.toString();
                    // Remember unread historical prefixes without downloading inactive logs.
                    // If an old conversation resumes later, only its appended records are live.
                    if (!this.trackers.has(key) && (!emitNotifications || !recent))
                        this.baselineFileSizes.set(key, size);
                });
                for (const file of files) {
                    const key = file.toString();
                    if (seenFiles.has(key))
                        continue;
                    seenFiles.add(key);
                    await this.refreshFile(file, emitNotifications);
                }
            }
            this.lastError = "";
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            console.error("[codex-task-companion] failed to poll Codex sessions", error);
        }
        finally {
            this.pollInFlight = false;
        }
    }
    async refreshFile(uri, emitNotifications) {
        const key = uri.toString();
        let tracker = this.trackers.get(key);
        if (!tracker) {
            tracker = {
                activity: new sessionActivity_1.SessionActivityTracker("codex", uri.toString(), this.onActivity),
                uri,
                offset: 0,
                remainder: "",
                lastKnownSize: 0,
                lastKnownMtimeMs: 0,
                isChild: false,
                turns: new Map(),
            };
            this.trackers.set(key, tracker);
            await this.processWholeFile(tracker, emitNotifications);
            return;
        }
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size === tracker.lastKnownSize && stat.mtime <= tracker.lastKnownMtimeMs)
            return;
        await this.processWholeFile(tracker, emitNotifications);
    }
    async processWholeFile(tracker, emitNotifications) {
        const stat = await vscode.workspace.fs.stat(tracker.uri);
        const bytes = await vscode.workspace.fs.readFile(tracker.uri);
        const text = Buffer.from(bytes).toString("utf8");
        if (text.length < tracker.offset) {
            tracker.activity.reset();
            tracker.offset = 0;
            tracker.remainder = "";
            tracker.sessionId = undefined;
            tracker.cwd = undefined;
            tracker.isChild = false;
            tracker.turns.clear();
            tracker.activeTurnId = undefined;
            tracker.latestTokenUsage = undefined;
            tracker.lastCompletedTokenUsage = undefined;
        }
        const baselineBytes = this.baselineFileSizes.get(tracker.uri.toString()) ?? 0;
        if (tracker.offset === 0 && emitNotifications && baselineBytes > 0 && bytes.length >= baselineBytes) {
            const prefix = Buffer.from(bytes.subarray(0, baselineBytes)).toString("utf8");
            const boundary = prefix.lastIndexOf("\n") + 1;
            for (const line of text.slice(0, boundary).split(/\r?\n/))
                await this.processLine(tracker, line, false);
            tracker.activity.flushBaseline();
            tracker.offset = boundary;
        }
        this.baselineFileSizes.delete(tracker.uri.toString());
        const combined = `${tracker.remainder}${text.slice(tracker.offset)}`;
        tracker.offset = text.length;
        tracker.lastKnownSize = stat.size;
        tracker.lastKnownMtimeMs = stat.mtime;
        if (!combined)
            return;
        const lines = combined.split(/\r?\n/);
        tracker.remainder = combined.endsWith("\n") ? "" : (lines.pop() ?? "");
        for (const line of lines)
            await this.processLine(tracker, line, emitNotifications);
        if (!emitNotifications)
            tracker.activity.flushBaseline();
    }
    async processLine(tracker, line, emitNotifications) {
        if (!line.trim())
            return;
        let record;
        try {
            record = JSON.parse(line);
        }
        catch {
            return;
        }
        tracker.activity.consume(record, emitNotifications);
        if (record.type === "session_meta") {
            const meta = asRecord(record.payload);
            tracker.sessionId = stringValue(meta.session_id) ?? stringValue(meta.id);
            tracker.cwd = stringValue(meta.cwd) ?? tracker.cwd;
            tracker.isChild = (0, core_1.mergeChildSessionClassification)(tracker.isChild, meta);
            return;
        }
        if (record.type === "turn_context") {
            const payload = asRecord(record.payload);
            const turnId = stringValue(payload.turn_id);
            if (!turnId)
                return;
            tracker.activeTurnId = turnId;
            const turn = this.getTurn(tracker, turnId);
            turn.cwd = stringValue(payload.cwd) ?? turn.cwd;
            turn.model = stringValue(payload.model) ?? turn.model;
            return;
        }
        if (record.type !== "event_msg")
            return;
        const payload = asRecord(record.payload);
        const payloadType = stringValue(payload.type);
        if (!payloadType)
            return;
        const turnId = stringValue(payload.turn_id) ?? tracker.activeTurnId;
        const turn = turnId ? this.getTurn(tracker, turnId) : undefined;
        if (payloadType === "task_started" && turnId) {
            tracker.activeTurnId = turnId;
            return;
        }
        if (payloadType === "user_message" && turn) {
            turn.userMessage = stringValue(payload.message) ?? turn.userMessage;
            return;
        }
        if (payloadType === "agent_message" && turn) {
            turn.lastAgentMessage = stringValue(payload.message) ?? turn.lastAgentMessage;
            return;
        }
        if (payloadType === "error" && turn) {
            turn.errorMessage = stringValue(payload.message) ?? turn.errorMessage;
            return;
        }
        if (payloadType === "token_count") {
            const usage = (0, core_1.normalizeTokenUsage)(asRecord(payload.info).total_token_usage);
            if (usage) {
                tracker.latestTokenUsage = usage;
                if (turn)
                    turn.tokenUsage = usage;
            }
            return;
        }
        if (payloadType !== "task_complete" || !turnId)
            return;
        const sessionId = tracker.sessionId ?? inferSessionId(tracker.uri);
        const eventId = `${sessionId}:${turnId}`;
        const completedAt = (0, core_1.normalizeTimestamp)(payload.completed_at) ?? (0, core_1.normalizeTimestamp)(record.timestamp);
        if (tracker.isChild) {
            this.skippedChildCount += 1;
            this.lastCompletionEvent = {
                eventId,
                outcome: "skipped-child-session",
                completedAt: completedAt ?? "",
                sessionFile: tracker.uri.toString(),
            };
            return;
        }
        if (this.processedEventIds.has(eventId))
            return;
        this.processedEventIds.add(eventId);
        const cwd = turn?.cwd ?? tracker.cwd;
        if (!matchesCurrentWorkspace(cwd)) {
            this.skippedWorkspaceCount += 1;
            this.lastCompletionEvent = {
                eventId,
                outcome: "skipped-workspace-mismatch",
                completedAt: completedAt ?? "",
                cwd: cwd ?? "",
                sessionFile: tracker.uri.toString(),
            };
            return;
        }
        const shouldNotify = (0, core_1.shouldNotifySessionCompletion)(emitNotifications, this.shouldNotifyInitialScan());
        if (!shouldNotify) {
            this.skippedInitialScanCount += 1;
            this.lastCompletionEvent = {
                eventId,
                outcome: "skipped-initial-scan",
                completedAt: completedAt ?? "",
                cwd: cwd ?? "",
                sessionFile: tracker.uri.toString(),
            };
            return;
        }
        const level = turn?.errorMessage ? "error" : "info";
        const projectName = (0, core_1.projectNameFromCwd)(cwd);
        const title = level === "error" ? `Codex 主任务失败 · ${projectName}` : `Codex 主任务已完成 · ${projectName}`;
        const detail = (0, core_1.truncate)(turn?.lastAgentMessage ?? turn?.errorMessage ?? turn?.userMessage ?? "任务已完成");
        const message = detail || "任务已完成";
        const completion = {
            id: eventId,
            title,
            message,
            level,
            sessionId,
            turnId,
            projectName,
            cwd,
        };
        this.lastCompletionEvent = {
            eventId,
            outcome: "notification-requested",
            completedAt: completedAt ?? "",
            cwd: cwd ?? "",
            sessionFile: tracker.uri.toString(),
        };
        void (0, notify_1.notifyDesktop)(completion.title, completion.message, completion.level, "codex", {
            hideTitle: true,
            workspacePath: completion.cwd,
            projectHint: completion.projectName,
            deduplicationKey: `codex:${completion.id}`,
        }).then((result) => {
            if (result.delivered)
                this.notificationCount += 1;
            if (this.lastCompletionEvent?.eventId !== eventId)
                return;
            this.lastCompletionEvent = {
                ...this.lastCompletionEvent,
                outcome: result.outcome,
            };
        });
    }
    getTurn(tracker, turnId) {
        const existing = tracker.turns.get(turnId);
        if (existing)
            return existing;
        const created = {};
        tracker.turns.set(turnId, created);
        return created;
    }
    shouldNotifyInitialScan() {
        return vscode.workspace
            .getConfiguration("codexTaskCompanion.codex")
            .get("notifyInitialScan", false);
    }
    isEnabled() {
        return vscode.workspace.getConfiguration("codexTaskCompanion.codex").get("enabled", true);
    }
    getPollMs() {
        return Math.max(500, vscode.workspace.getConfiguration("codexTaskCompanion.codex").get("sessionPollMs", 1500));
    }
    getLookbackDays() {
        return Math.max(1, Math.min(14, Math.floor(vscode.workspace.getConfiguration("codexTaskCompanion.codex").get("sessionLookbackDays", 7))));
    }
}
exports.CodexSessionMonitor = CodexSessionMonitor;
async function resolveSessionsRootUris() {
    const config = vscode.workspace.getConfiguration("codexTaskCompanion.codex");
    const configured = config.get("sessionsRoot", "").trim();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (configured)
        return [await resolveConfiguredRoot(configured, folder?.uri)];
    const roots = [];
    if (folder?.uri.scheme !== "file" && folder?.uri) {
        const remoteHome = await findRemoteHome(folder.uri);
        if (remoteHome)
            roots.push(vscode.Uri.joinPath(remoteHome, ".codex", "sessions"));
    }
    const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
    roots.push(vscode.Uri.file(path.join(codexHome, "sessions")));
    const unique = new Map();
    for (const root of roots)
        unique.set(root.toString(), root);
    return [...unique.values()];
}
async function resolveConfiguredRoot(value, reference) {
    if (reference?.scheme !== "file" && reference) {
        if (value.startsWith("~")) {
            const home = await findRemoteHome(reference);
            return home ? vscode.Uri.joinPath(home, ...splitSegments(value.slice(1))) : reference;
        }
        if (value.startsWith("/"))
            return reference.with({ path: value.replace(/\\/g, "/") });
        return vscode.Uri.joinPath(reference, ...splitSegments(value));
    }
    const base = process.env.CODEX_HOME || os.homedir();
    if (value.startsWith("~"))
        return vscode.Uri.file(path.join(os.homedir(), value.slice(1)));
    if (path.isAbsolute(value))
        return vscode.Uri.file(value);
    return vscode.Uri.file(path.join(reference?.fsPath ?? base, value));
}
async function findRemoteHome(reference) {
    const candidates = new Set();
    const inferred = (0, core_1.remoteHomeFromWorkspacePath)(reference.path);
    if (inferred)
        candidates.add(inferred);
    if (reference.path === "/root" || reference.path.startsWith("/root/"))
        candidates.add("/root");
    candidates.add("/root");
    for (const base of ["/home", "/Users"]) {
        try {
            for (const [name, type] of await vscode.workspace.fs.readDirectory(reference.with({ path: base }))) {
                if ((type & vscode.FileType.Directory) !== 0)
                    candidates.add(path.posix.join(base, name));
            }
        }
        catch {
            // Ignore directories that are not visible in this remote provider.
        }
    }
    for (const candidate of candidates) {
        const home = reference.with({ path: candidate });
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(home, ".codex", "sessions"));
            if ((stat.type & vscode.FileType.Directory) !== 0)
                return home;
        }
        catch {
            // Try the next candidate.
        }
    }
    return undefined;
}
async function collectRecentSessionFiles(root, lookbackDays, observed) {
    const files = [];
    // A resumed conversation keeps its original date directory. Discover by
    // modification time across the tree, rather than by its creation-day folder.
    await collectJsonlFiles(root, files, Date.now() - lookbackDays * 24 * 60 * 60 * 1000, observed);
    return files;
}
async function collectJsonlFiles(folder, files, cutoff, observed) {
    let entries;
    try {
        entries = await vscode.workspace.fs.readDirectory(folder);
    }
    catch {
        return;
    }
    for (const [name, type] of entries) {
        const uri = vscode.Uri.joinPath(folder, name);
        if ((type & vscode.FileType.Directory) !== 0) {
            await collectJsonlFiles(uri, files, cutoff, observed);
        }
    }
    const candidates = entries.filter(([name, type]) => (type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".jsonl"));
    // Bound remote metadata requests; inactive history is never downloaded.
    for (let offset = 0; offset < candidates.length; offset += 16) {
        await Promise.all(candidates.slice(offset, offset + 16).map(async ([name]) => {
            const uri = vscode.Uri.joinPath(folder, name);
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                const recent = stat.mtime >= cutoff;
                observed(uri, stat.size, recent);
                if (recent)
                    files.push(uri);
            }
            catch { /* A session may disappear or rotate during discovery. */ }
        }));
    }
}
function matchesCurrentWorkspace(cwd) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length || !cwd)
        return true;
    return folders.some((folder) => {
        const root = folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path;
        return (0, core_1.workspacePathsOverlap)(root, cwd);
    });
}
function inferSessionId(uri) {
    const match = uri.path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
    return match?.[1] ?? path.basename(uri.path, path.extname(uri.path));
}
function splitSegments(value) {
    return value.split(/[\\/]+/).filter(Boolean);
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
