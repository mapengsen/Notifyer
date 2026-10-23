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
exports.ClaudeSessionMonitor = void 0;
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const core_1 = require("./core");
const notify_1 = require("./notify");
const sessionActivity_1 = require("./sessionActivity");
class ClaudeSessionMonitor {
    onActivity;
    constructor(onActivity = () => { }) {
        this.onActivity = onActivity;
    }
    trackers = new Map();
    processedEventIds = new Set();
    pollTimer;
    pollInFlight = false;
    projectsRootUri;
    lastError = "";
    pollCount = 0;
    notificationCount = 0;
    async start() {
        await this.restart();
    }
    async restart() {
        if (this.pollTimer)
            clearInterval(this.pollTimer);
        this.pollTimer = undefined;
        this.trackers.clear();
        this.processedEventIds.clear();
        this.projectsRootUri = undefined;
        await this.poll(false);
        this.pollTimer = setInterval(() => void this.poll(true), this.getPollMs());
    }
    getDiagnostics() {
        return {
            running: Boolean(this.pollTimer),
            projectsRoot: this.projectsRootUri?.toString() ?? "",
            trackedFileCount: this.trackers.size,
            processedEventCount: this.processedEventIds.size,
            pollCount: this.pollCount,
            notificationCount: this.notificationCount,
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
            this.projectsRootUri ??= await resolveClaudeProjectsRootUri();
            if (!this.projectsRootUri)
                return;
            const files = await collectRecentJsonlFiles(this.projectsRootUri, this.getLookbackDays());
            for (const file of files)
                await this.refreshFile(file, emitNotifications);
            this.lastError = "";
        }
        catch (error) {
            this.lastError = error instanceof Error ? error.message : String(error);
            console.error("[codex-task-companion] failed to poll Claude sessions", error);
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
                activity: new sessionActivity_1.SessionActivityTracker("claude", uri.toString(), this.onActivity),
                uri,
                offset: 0,
                remainder: "",
                lastKnownSize: 0,
                lastKnownMtimeMs: 0,
                isSidechain: false,
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
            tracker.isSidechain = false;
        }
        const combined = `${tracker.remainder}${text.slice(tracker.offset)}`;
        tracker.offset = text.length;
        tracker.lastKnownSize = stat.size;
        tracker.lastKnownMtimeMs = stat.mtime;
        if (!combined)
            return;
        const lines = combined.split(/\r?\n/);
        tracker.remainder = combined.endsWith("\n") ? "" : (lines.pop() ?? "");
        for (const line of lines)
            this.processLine(tracker, line, emitNotifications);
        if (!emitNotifications)
            tracker.activity.flushBaseline();
    }
    processLine(tracker, line, emitNotifications) {
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
        tracker.sessionId = stringValue(record.sessionId) ?? tracker.sessionId;
        tracker.cwd = stringValue(record.cwd) ?? tracker.cwd;
        if (record.isSidechain === true || stringValue(record.agent_id) || stringValue(record.agentId)) {
            tracker.isSidechain = true;
        }
        if (!(0, core_1.isClaudeMainTaskCompletion)(record) || tracker.isSidechain)
            return;
        const sessionId = tracker.sessionId ?? inferSessionId(tracker.uri);
        const eventId = `${sessionId}:${stringValue(record.uuid) ?? String(record.timestamp ?? tracker.offset)}`;
        if (this.processedEventIds.has(eventId))
            return;
        this.processedEventIds.add(eventId);
        const cwd = tracker.cwd;
        if (!matchesCurrentWorkspace(cwd))
            return;
        const shouldNotify = (0, core_1.shouldNotifySessionCompletion)(emitNotifications, this.shouldNotifyInitialScan());
        if (!shouldNotify)
            return;
        const projectName = (0, core_1.projectNameFromCwd)(cwd);
        const detail = summarizeClaudeAssistant(record);
        const title = `Claude 主任务已完成 · ${projectName}`;
        const message = detail || "任务已完成";
        void (0, notify_1.notifyDesktop)(title, message, "info", "claude", {
            hideTitle: true,
            focus: notify_1.focusClaudePage,
            workspacePath: cwd,
            projectHint: projectName,
            deduplicationKey: `claude:${eventId}`,
        }).then((result) => {
            if (result.delivered)
                this.notificationCount += 1;
        });
    }
    shouldNotifyInitialScan() {
        return vscode.workspace
            .getConfiguration("codexTaskCompanion.claude")
            .get("notifyInitialScan", false);
    }
    isEnabled() {
        return vscode.workspace.getConfiguration("codexTaskCompanion.claude").get("enabled", true);
    }
    getPollMs() {
        return Math.max(500, vscode.workspace.getConfiguration("codexTaskCompanion.claude").get("sessionPollMs", 1500));
    }
    getLookbackDays() {
        return Math.max(1, Math.min(30, Math.floor(vscode.workspace.getConfiguration("codexTaskCompanion.claude").get("sessionLookbackDays", 7))));
    }
}
exports.ClaudeSessionMonitor = ClaudeSessionMonitor;
async function resolveClaudeProjectsRootUri() {
    const config = vscode.workspace.getConfiguration("codexTaskCompanion.claude");
    const configured = config.get("projectsRoot", "").trim();
    if (configured)
        return resolveConfiguredRoot(configured);
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder?.uri.scheme !== "file" && folder?.uri) {
        const home = await findRemoteHome(folder.uri);
        return home ? vscode.Uri.joinPath(home, ".claude", "projects") : undefined;
    }
    const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
    return vscode.Uri.file(path.join(configDir, "projects"));
}
async function resolveConfiguredRoot(value) {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (folder?.uri.scheme !== "file" && folder?.uri) {
        if (value.startsWith("~")) {
            const home = await findRemoteHome(folder.uri);
            return home ? vscode.Uri.joinPath(home, ...splitSegments(value.slice(1))) : folder.uri;
        }
        if (value.startsWith("/"))
            return folder.uri.with({ path: value.replace(/\\/g, "/") });
        return vscode.Uri.joinPath(folder.uri, ...splitSegments(value));
    }
    if (isWindowsAbsolute(value) || path.isAbsolute(value))
        return vscode.Uri.file(value);
    return vscode.Uri.file(path.join(os.homedir(), value));
}
async function findRemoteHome(reference) {
    const candidates = new Set();
    const inferred = (0, core_1.remoteHomeFromWorkspacePath)(reference.path);
    if (inferred)
        candidates.add(inferred);
    candidates.add("/root");
    for (const base of ["/home", "/Users"]) {
        try {
            for (const [name, type] of await vscode.workspace.fs.readDirectory(reference.with({ path: base }))) {
                if ((type & vscode.FileType.Directory) !== 0)
                    candidates.add(path.posix.join(base, name));
            }
        }
        catch {
            // Ignore remote directories that are not visible to this workspace provider.
        }
    }
    for (const candidate of candidates) {
        const home = reference.with({ path: candidate });
        try {
            const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(home, ".claude", "projects"));
            if ((stat.type & vscode.FileType.Directory) !== 0)
                return home;
        }
        catch {
            // Try the next candidate.
        }
    }
    return undefined;
}
async function collectRecentJsonlFiles(root, lookbackDays) {
    const files = [];
    const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
    await collectJsonlFiles(root, files, cutoff);
    return files;
}
async function collectJsonlFiles(folder, files, cutoff) {
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
            await collectJsonlFiles(uri, files, cutoff);
        }
        else if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".jsonl")) {
            try {
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.mtime >= cutoff)
                    files.push(uri);
            }
            catch {
                // The session may be rotated while it is being scanned.
            }
        }
    }
}
function summarizeClaudeAssistant(record) {
    const message = asRecord(record.message);
    const content = message.content;
    if (typeof content === "string")
        return (0, core_1.truncate)(content);
    if (!Array.isArray(content))
        return "任务已完成";
    const text = content
        .filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
        .map((item) => stringValue(item.text))
        .filter((value) => Boolean(value))
        .join(" ");
    return (0, core_1.truncate)(text || "任务已完成");
}
function matchesCurrentWorkspace(cwd) {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length || !cwd)
        return true;
    const candidate = normalizePath(cwd);
    return folders.some((folder) => {
        const root = normalizePath(folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path);
        return root === candidate || candidate.startsWith(`${root}/`) || root.startsWith(`${candidate}/`);
    });
}
function normalizePath(value) {
    let normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    if (/^[A-Za-z]:/.test(normalized))
        normalized = normalized.toLowerCase();
    return normalized || "/";
}
function inferSessionId(uri) {
    const match = uri.path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
    return match?.[1] ?? path.basename(uri.path, path.extname(uri.path));
}
function asRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value : undefined;
}
function isWindowsAbsolute(value) {
    return /^[A-Za-z]:[\\/]/.test(value);
}
function splitSegments(value) {
    return value.split(/[\\/]+/).filter(Boolean);
}
