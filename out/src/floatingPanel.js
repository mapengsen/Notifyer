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
exports.FloatingPanel = void 0;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const vscode = __importStar(require("vscode"));
const core_1 = require("./core");
const notify_1 = require("./notify");
const sessionFocus_1 = require("./sessionFocus");
const sessionNavigator_1 = require("./sessionNavigator");
const sessionViewMonitor_1 = require("./sessionViewMonitor");
const sessionSelection_1 = require("./sessionSelection");
const floatingState_1 = require("./floatingState");
class FloatingPanel {
    context;
    windowId = (0, node_crypto_1.randomUUID)();
    sessions = new Map();
    root;
    timer;
    publishTimer;
    enabled = false;
    disposed = false;
    lastError = "";
    lastLaunchAt = 0;
    launchAttempts = 0;
    lastExit = "";
    existingHelperDetected = false;
    focusGeneration = 0;
    focusQueue = Promise.resolve();
    viewMonitor;
    lastNavigation;
    statusItem;
    statusTimer;
    output = vscode.window.createOutputChannel("Notifyer Floating Window");
    constructor(context) {
        this.context = context;
        this.root = path.join(context.globalStorageUri.fsPath, "floating-panel");
        if (process.platform !== "win32")
            return;
        this.statusItem = vscode.window.createStatusBarItem("codexTaskCompanion.floatingWindow", vscode.StatusBarAlignment.Right, 100);
        this.statusItem.name = "Notifyer 桌面悬浮窗";
        this.statusItem.command = "codexTaskCompanion.toggleFloatingWindow";
        this.updateStatusBar();
        this.statusItem.show();
        this.statusTimer = setInterval(() => this.updateStatusBar(), 500);
        this.restore();
        this.configure();
        this.timer = setInterval(() => this.tick(), 2000);
        this.viewMonitor = new sessionViewMonitor_1.SessionViewMonitor(context, () => this.enabled && !this.disposed ? [...this.sessions.values()] : [], (result) => this.safe(() => {
            if (!this.enabled || this.disposed || !(0, sessionSelection_1.isPendingResult)(this.sessions.get(result.key), result))
                return;
            const file = path.join(this.root, "read", `${result.acknowledgement}.json`);
            if (fs.existsSync(file))
                return;
            (0, floatingState_1.atomicWriteJson)(file, { at: Date.now(), source: "session-selected" });
            this.publishModel();
        }));
        context.subscriptions.push(vscode.commands.registerCommand("codexTaskCompanion.showFloatingWindow", () => this.open()), vscode.commands.registerCommand("codexTaskCompanion.hideFloatingWindow", () => this.command("hide")), vscode.commands.registerCommand("codexTaskCompanion.toggleFloatingWindow", () => {
            if (this.isVisible())
                this.command("hide");
            else
                return this.open();
        }), vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("codexTaskCompanion.floatingWindow"))
                this.configure();
            for (const provider of ["codex", "claude"]) {
                if (event.affectsConfiguration(`codexTaskCompanion.${provider}.enabled`)
                    && !vscode.workspace.getConfiguration(`codexTaskCompanion.${provider}`).get("enabled", true)) {
                    for (const session of this.sessions.values()) {
                        if (session.provider === provider && session.status === "running")
                            session.status = "unknown";
                    }
                }
            }
        }));
    }
    accept = (activity, remove = false) => {
        if (process.platform !== "win32" || !this.enabled || this.disposed)
            return;
        if (remove)
            this.sessions.delete(activity.key);
        else {
            // Unknown workspace membership is not enough to claim a conversation.
            const folders = vscode.workspace.workspaceFolders ?? [];
            if (!activity.cwd || !folders.some((folder) => (0, core_1.workspacePathsOverlap)(folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path, activity.cwd)))
                return;
            this.sessions.set(activity.key, (0, floatingState_1.applyActivity)(this.sessions.get(activity.key), activity));
        }
        if (!this.publishTimer)
            this.publishTimer = setTimeout(() => {
                this.publishTimer = undefined;
                this.safe(() => this.publish());
            }, 150);
    };
    getDiagnostics() {
        let panelError = "";
        try {
            panelError = fs.readFileSync(path.join(this.root, "panel-error.log"), "utf8");
        }
        catch { }
        return { supported: process.platform === "win32", enabled: this.enabled, extensionVersion: this.context.extension.packageJSON.version, root: this.root,
            windowId: this.windowId, sessionCount: this.sessions.size, lastError: this.lastError, panelError,
            helper: this.heartbeat(), helperHealthy: (0, floatingState_1.isPanelHealthy)(this.heartbeat()), lastLaunchAt: this.lastLaunchAt,
            launchAttempts: this.launchAttempts, lastExit: this.lastExit, existingHelperDetected: this.existingHelperDetected,
            floatingWindowVisible: this.isVisible(), statusBarEntry: process.platform === "win32", sessionSelection: this.viewMonitor?.getDiagnostics(), navigation: this.lastNavigation };
    }
    dispose() {
        this.disposed = true;
        if (this.timer)
            clearInterval(this.timer);
        if (this.statusTimer)
            clearInterval(this.statusTimer);
        if (this.publishTimer)
            clearTimeout(this.publishTimer);
        this.viewMonitor?.dispose();
        if (process.platform === "win32")
            this.safe(() => this.publish(true));
        this.output.dispose();
        this.statusItem?.dispose();
    }
    configure() {
        const wasEnabled = this.enabled;
        this.enabled = vscode.workspace.getConfiguration("codexTaskCompanion.floatingWindow").get("enabled", true);
        // A transient snapshot replacement error must not skip the UI launch.
        this.safe(() => this.publish(!this.enabled));
        if (this.enabled && !wasEnabled)
            this.safe(() => {
                const request = this.visibilityRequest();
                // A hide click made while settings are being enabled must win.
                if (request?.type !== "hide" || Date.now() - request.requestedAt >= 10_000)
                    this.show();
            });
        if (!this.enabled && wasEnabled)
            this.safe(() => { this.command("hide"); });
    }
    snapshots() {
        const folder = path.join(this.root, "windows");
        if (!fs.existsSync(folder))
            return [];
        const values = [];
        for (const name of fs.readdirSync(folder)) {
            if (!/^[a-f0-9-]+\.json$/.test(name))
                continue;
            try {
                const value = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8"));
                if (value.version === 1 && Array.isArray(value.sessions))
                    values.push(value);
            }
            catch { /* Another host may be replacing a snapshot; retry next tick. */ }
        }
        return values;
    }
    workspace() {
        return vscode.workspace.workspaceFile?.toString()
            ?? (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()).sort().join("|");
    }
    restore() {
        this.safe(() => {
            for (const snapshot of this.snapshots()) {
                if (snapshot.workspace !== this.workspace() || !snapshot.workspace)
                    continue;
                for (const session of snapshot.sessions) {
                    if (!this.sessions.has(session.key) || this.sessions.get(session.key).updatedAt < session.updatedAt) {
                        this.sessions.set(session.key, session);
                    }
                }
            }
        });
    }
    publish(closed = false) {
        const snapshot = {
            version: 1, windowId: this.windowId, workspace: this.workspace(),
            extensionVersion: this.context.extension.packageJSON.version,
            sessionSelection: this.viewMonitor?.getDiagnostics(), navigation: this.lastNavigation,
            project: vscode.workspace.name ?? "未打开文件夹",
            environment: vscode.env.remoteName ?? "本地",
            windowHandle: String((0, notify_1.getNotificationDiagnostics)().originatingWindowHandle ?? ""),
            pid: process.pid, heartbeat: Date.now(), closed, sessions: [...this.sessions.values()],
        };
        (0, floatingState_1.atomicWriteJson)(path.join(this.root, "windows", `${this.windowId}.json`), snapshot);
        this.publishModel();
    }
    publishModel() {
        const quietMinutes = Math.max(1, vscode.workspace.getConfiguration("codexTaskCompanion.floatingWindow")
            .get("quietAfterMinutes", 30));
        const rows = (0, floatingState_1.aggregateSessions)(this.snapshots(), (key) => fs.existsSync(path.join(this.root, "read", `${key}.json`)), Date.now(), quietMinutes * 60_000);
        (0, floatingState_1.atomicWriteJson)(path.join(this.root, "model.json"), {
            rows, updatedAt: Date.now(), desktopNotificationsEnabled: (0, notify_1.areDesktopNotificationsEnabled)(),
        });
    }
    tick() {
        if (!this.enabled || this.disposed)
            return;
        this.safe(() => this.publish());
        this.safe(() => {
            if ((0, floatingState_1.isPanelHealthy)(this.heartbeat()))
                this.launchAttempts = 0;
            else if (Date.now() - this.lastLaunchAt >= Math.min(120_000, 15_000 * 2 ** Math.min(this.launchAttempts, 3))) {
                this.launch();
            }
        });
        const commands = path.join(this.root, "commands", this.windowId);
        if (!fs.existsSync(commands))
            return;
        const pending = [];
        for (const name of fs.readdirSync(commands)) {
            if (!/^[a-f0-9-]+\.json$/.test(name))
                continue;
            this.safe(() => {
                const file = path.join(commands, name);
                const action = JSON.parse(fs.readFileSync(file, "utf8"));
                const at = Number.isFinite(action.requestedAt) ? action.requestedAt : fs.statSync(file).mtimeMs;
                fs.unlinkSync(file);
                if (action.type === "focus")
                    pending.push({ action, at });
            });
        }
        for (const { action } of pending.sort((a, b) => a.at - b.at)) {
            const generation = ++this.focusGeneration;
            this.focusQueue = this.focusQueue.then(async () => {
                if (this.disposed || generation !== this.focusGeneration)
                    return;
                const result = await (0, sessionFocus_1.focusSession)(action, {
                    getSession: (key) => this.sessions.get(key),
                    focusWindow: async () => {
                        const result = await (0, notify_1.focusOriginatingWindow)();
                        if (result.startsWith("failed") || result === "unavailable")
                            return false;
                        for (let delay = 0; delay < 1000 && !vscode.window.state.focused && generation === this.focusGeneration; delay += 50) {
                            await new Promise((resolve) => setTimeout(resolve, 50));
                        }
                        return vscode.window.state.focused;
                    },
                    openSession: async (session) => {
                        try {
                            return await (0, sessionNavigator_1.openSession)(session, (target) => this.viewMonitor?.confirms(target) ?? false, (diagnostics) => { this.lastNavigation = diagnostics; });
                        }
                        catch (error) {
                            this.report(error);
                            return false;
                        }
                    },
                    isCurrentAndFocused: () => !this.disposed && generation === this.focusGeneration && vscode.window.state.focused,
                    acknowledge: (key) => (0, floatingState_1.atomicWriteJson)(path.join(this.root, "read", `${key}.json`), { at: Date.now(), source: "session-opened" }),
                });
                if (generation !== this.focusGeneration || this.disposed)
                    return;
                this.publishModel();
                (0, floatingState_1.atomicWriteJson)(path.join(this.root, "response.json"), { message: result === "failed" ? "无法切换窗口"
                        : result === "window-only" && action.key ? this.lastNavigation?.phase === "sidebar-open-requested"
                            ? "已请求在 Codex 侧边栏打开指定对话；未确认已查看，保留提醒"
                            : "已返回窗口；未确认具体对话，保留待查看" : "", at: Date.now() });
            }).catch((error) => this.report(error));
        }
    }
    command(type) {
        const request = { type, id: (0, node_crypto_1.randomUUID)(), requestedAt: Date.now() };
        (0, floatingState_1.atomicWriteJson)(path.join(this.root, "control.json"), request);
        this.updateStatusBar();
        return request;
    }
    async open() {
        const request = this.command("show");
        if (!this.enabled) {
            await vscode.workspace.getConfiguration("codexTaskCompanion.floatingWindow")
                .update("enabled", true, vscode.ConfigurationTarget.Global);
            this.enabled = true;
        }
        if (this.visibilityRequest()?.type === "hide")
            return;
        this.safe(() => this.publish());
        if (!(0, floatingState_1.isPanelHealthy)(this.heartbeat()))
            this.launch();
        const deadline = Date.now() + 10_000;
        while (!this.disposed && Date.now() < deadline && !(0, floatingState_1.isPanelHealthy)(this.heartbeat()) && !this.existingHelperDetected) {
            if (this.visibilityRequest()?.type === "hide")
                return;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        if (!this.disposed && !(0, floatingState_1.isPanelHealthy)(this.heartbeat()) && !this.existingHelperDetected
            && this.visibilityRequest()?.id === request.id) {
            const selected = await vscode.window.showWarningMessage("Notifyer 悬浮窗尚未启动，请查看诊断中的 floatingWindow 和启动日志。", "查看诊断");
            if (selected)
                await vscode.commands.executeCommand("codexTaskCompanion.showDiagnostics");
        }
    }
    visibilityRequest() {
        try {
            return JSON.parse(fs.readFileSync(path.join(this.root, "control.json"), "utf8"));
        }
        catch {
            return undefined;
        }
    }
    isVisible() {
        return (0, floatingState_1.panelVisibility)(this.heartbeat(), this.visibilityRequest());
    }
    updateStatusBar() {
        if (!this.statusItem || this.disposed)
            return;
        const visible = this.isVisible();
        this.statusItem.text = `${visible ? "$(eye)" : "$(eye-closed)"} Notifyer`;
        this.statusItem.tooltip = visible ? "Notifyer：点击隐藏桌面悬浮窗" : "Notifyer：点击显示桌面悬浮窗";
        this.statusItem.accessibilityInformation = { label: this.statusItem.tooltip, role: "button" };
    }
    show() {
        this.command("show");
        if (!(0, floatingState_1.isPanelHealthy)(this.heartbeat()))
            this.launch();
    }
    heartbeat() {
        try {
            return JSON.parse(fs.readFileSync(path.join(this.root, "panel-heartbeat.json"), "utf8"));
        }
        catch {
            return undefined;
        }
    }
    launch() {
        this.lastLaunchAt = Date.now();
        this.launchAttempts += 1;
        this.existingHelperDetected = false;
        const executable = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        this.output.appendLine(`${new Date().toISOString()} Starting floating window (attempt ${this.launchAttempts})`);
        const child = (0, node_child_process_1.spawn)(executable, ["-NoProfile", "-STA", "-WindowStyle", "Hidden",
            "-ExecutionPolicy", "Bypass", "-File", path.join(this.context.extensionPath, "resources", "floating-panel.ps1"),
            "-StateRoot", this.root, "-InstanceKey", (0, floatingState_1.digest)(this.root).slice(0, 24)], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout?.setEncoding("utf8");
        child.stderr?.setEncoding("utf8");
        child.stdout?.on("data", (value) => {
            if (this.disposed)
                return;
            if (value.includes("instance=already-running"))
                this.existingHelperDetected = true;
            this.output.appendLine(value.trim());
        });
        child.stderr?.on("data", (value) => { if (!this.disposed)
            this.report(value.trim()); });
        child.on("exit", (code, signal) => {
            if (this.disposed)
                return;
            this.lastExit = `code=${code};signal=${signal ?? ""}`;
            this.output.appendLine(`${new Date().toISOString()} Floating window helper exited (${this.lastExit})`);
        });
        child.on("error", (error) => this.report(error));
        child.unref();
    }
    safe(action) {
        try {
            action();
        }
        catch (error) {
            this.report(error);
        }
    }
    report(error) {
        this.lastError = error instanceof Error ? error.message : String(error);
        this.output.appendLine(`${new Date().toISOString()} ${this.lastError}`);
    }
}
exports.FloatingPanel = FloatingPanel;
