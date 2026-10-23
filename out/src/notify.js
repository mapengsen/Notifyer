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
exports.getNotificationDiagnostics = getNotificationDiagnostics;
exports.initializeNotifications = initializeNotifications;
exports.areDesktopNotificationsEnabled = areDesktopNotificationsEnabled;
exports.focusClaudePage = focusClaudePage;
exports.focusOriginatingWindow = focusOriginatingWindow;
exports.notifyDesktop = notifyDesktop;
const node_child_process_1 = require("node:child_process");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const vscode = __importStar(require("vscode"));
const core_1 = require("./core");
const notificationClaimStore_1 = require("./notificationClaimStore");
const notificationPolicy_1 = require("./notificationPolicy");
const floatingState_1 = require("./floatingState");
const NOTIFYER_APP_ID = "Notifyer";
let extensionContext;
let windowsNotificationRegistration;
let notificationClaimStore;
let desktopNotificationPolicyPath;
let originatingWindowHandle = "";
let windowCaptureGeneration = 0;
const notificationDiagnostics = {
    clickCount: 0,
    lastCallbackAt: "",
    lastResponse: "",
    lastActivationType: "",
    lastActivationValue: "",
    lastClickAt: "",
    lastFocusAt: "",
    lastFocusResult: "",
    lastTargetWindowHandle: "",
    duplicateSuppressedCount: 0,
    lastDeliveryOutcome: "",
};
function getNotificationDiagnostics() {
    return {
        ...notificationDiagnostics,
        openVsCodeOnClick: shouldOpenVsCodeOnClick(),
        originatingWindowHandle,
        windowFocused: vscode.window.state.focused,
        desktopNotificationsEnabled: areDesktopNotificationsEnabled(),
    };
}
function initializeNotifications(context) {
    extensionContext = context;
    desktopNotificationPolicyPath = path.join(context.globalStorageUri.fsPath, "floating-panel", "notification-policy.json");
    context.subscriptions.push(vscode.commands.registerCommand("codexTaskCompanion.toggleDesktopNotifications", async () => {
        const enabled = !areDesktopNotificationsEnabled();
        (0, floatingState_1.atomicWriteJson)(desktopNotificationPolicyPath, { desktopEnabled: enabled, updatedAt: Date.now() });
        await vscode.window.showInformationMessage(`Notifyer：桌面通知已${enabled ? "开启" : "关闭"}。`);
    }));
    notificationClaimStore = new notificationClaimStore_1.NotificationClaimStore(path.join(context.globalStorageUri.fsPath, "notification-claims"));
    try {
        notificationClaimStore.pruneExpiredClaims();
    }
    catch (error) {
        console.error("[codex-task-companion] failed to prune notification claims", error);
    }
    windowsNotificationRegistration = registerWindowsNotificationApp(context);
    if (process.platform !== "win32")
        return;
    context.subscriptions.push(vscode.window.onDidChangeWindowState((state) => {
        trackOriginatingWindow(state.focused);
    }));
    trackOriginatingWindow(vscode.window.state.focused);
}
function areDesktopNotificationsEnabled() {
    return (0, notificationPolicy_1.readDesktopNotificationPolicy)(desktopNotificationPolicyPath);
}
async function focusClaudePage() {
    await runFirstAvailableCommand([
        "claude-code-chat.openChat",
        "workbench.action.chat.open",
        "workbench.action.terminal.focus",
    ]);
}
async function runFirstAvailableCommand(commands) {
    for (const command of commands) {
        try {
            await vscode.commands.executeCommand(command);
            return;
        }
        catch {
            // Try the next command contributed by a compatible extension/version.
        }
    }
}
function trackOriginatingWindow(focused) {
    const generation = ++windowCaptureGeneration;
    if (!focused)
        return;
    void captureForegroundVsCodeWindow().then((handle) => {
        if (!handle || generation !== windowCaptureGeneration || !vscode.window.state.focused)
            return;
        originatingWindowHandle = handle;
    });
}
function registerWindowsNotificationApp(context) {
    if (process.platform !== "win32")
        return Promise.resolve();
    const appData = process.env.APPDATA;
    if (!appData)
        return Promise.resolve();
    const architecture = process.arch === "x64" ? "x64" : "x86";
    const snoreToastPath = path.join(context.extensionPath, "node_modules", "node-notifier", "vendor", "snoreToast", `snoretoast-${architecture}.exe`);
    if (!fs.existsSync(snoreToastPath)) {
        console.error("[codex-task-companion] SnoreToast binary was not found", snoreToastPath);
        return Promise.resolve();
    }
    const shortcutPath = path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", "Notifyer.lnk");
    if (fs.existsSync(shortcutPath))
        return Promise.resolve();
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            resolve();
        };
        try {
            const child = (0, node_child_process_1.spawn)(snoreToastPath, ["-install", shortcutPath, process.env.VSCODE_EXEC_PATH || process.execPath, NOTIFYER_APP_ID], { windowsHide: true, stdio: "ignore" });
            child.once("error", (error) => {
                console.error("[codex-task-companion] failed to register Notifyer Windows app", error);
                finish();
            });
            child.once("close", finish);
            setTimeout(finish, 5000);
        }
        catch (error) {
            console.error("[codex-task-companion] failed to start Notifyer Windows app registration", error);
            finish();
        }
    });
}
function getNativeNotifier() {
    try {
        const loaded = require("node-notifier");
        return "notify" in loaded ? loaded : loaded.default;
    }
    catch {
        return undefined;
    }
}
function getMode() {
    const configured = vscode.workspace
        .getConfiguration("codexTaskCompanion.notifications")
        .get("mode", "Desktop");
    return configured === "VS Code" || configured === "Both" ? configured : "Desktop";
}
function shouldSuppressWhenFocused() {
    return vscode.workspace
        .getConfiguration("codexTaskCompanion.notifications")
        .get("onlyWhenWindowUnfocused", false) && vscode.window.state.focused;
}
function shouldOpenVsCodeOnClick() {
    return vscode.workspace
        .getConfiguration("codexTaskCompanion.notifications")
        .get("openVsCodeOnClick", true);
}
function getWorkspaceProjectName() {
    return vscode.workspace.workspaceFolders?.[0]?.name ?? "";
}
function getWorkspacePath() {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder)
        return "";
    return folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path;
}
function getNotificationIcon(kind) {
    if (!extensionContext)
        return undefined;
    return path.join(extensionContext.extensionPath, "resources", "images", kind === "terminal"
        ? "terminal.png"
        : kind === "claude"
            ? "claude.png"
            : "blossom.dark.png");
}
async function captureForegroundVsCodeWindow() {
    if (process.platform !== "win32" || !extensionContext)
        return undefined;
    const scriptPath = path.join(extensionContext.extensionPath, "resources", "capture-vscode-window.ps1");
    const output = await runPowerShellScript(scriptPath, [], true);
    const handles = output
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line));
    const handle = handles[handles.length - 1];
    return handle && handle !== "0" ? handle : undefined;
}
async function focusVsCodeWindow(workspacePath, projectHint, windowHandle) {
    const workbenchFocused = await focusCurrentWorkbenchWindow();
    if (process.platform !== "win32" || !extensionContext) {
        return workbenchFocused ? "vscode-command" : "unavailable";
    }
    const scriptPath = path.join(extensionContext.extensionPath, "resources", "focus-vscode.ps1");
    const scriptArgs = [
        "-WindowHandle", windowHandle || "0",
        "-ProjectHint", projectHint,
        "-WorkspacePath", workspacePath,
        "-SourceProcessId", String(process.pid),
    ];
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const output = await runPowerShellScript(scriptPath, scriptArgs, true);
        const result = output.trim().split(/\r?\n/).find((line) => line.startsWith("activated="));
        if (result?.startsWith("activated=true")) {
            return `windows-native:${result}`;
        }
        if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 150));
        }
    }
    return workbenchFocused ? "vscode-command-only" : "failed";
}
/** Used by the floating panel's per-window IPC; never changes read state. */
async function focusOriginatingWindow() {
    return focusVsCodeWindow(getWorkspacePath(), getWorkspaceProjectName(), originatingWindowHandle);
}
async function focusCurrentWorkbenchWindow() {
    if (vscode.window.state.focused)
        return true;
    try {
        const commands = await vscode.commands.getCommands(true);
        if (!commands.includes("workbench.action.focusWindow"))
            return false;
        await vscode.commands.executeCommand("workbench.action.focusWindow");
        if (!vscode.window.state.focused) {
            await new Promise((resolve) => setTimeout(resolve, 75));
        }
        return vscode.window.state.focused;
    }
    catch {
        return false;
    }
}
function runPowerShellScript(scriptPath, scriptArgs, captureOutput) {
    return new Promise((resolve) => {
        let settled = false;
        let output = "";
        let timeout;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            if (timeout)
                clearTimeout(timeout);
            resolve(output);
        };
        try {
            const child = (0, node_child_process_1.spawn)("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs], {
                windowsHide: true,
                stdio: captureOutput ? ["ignore", "pipe", "ignore"] : "ignore",
            });
            if (captureOutput && child.stdout) {
                child.stdout.setEncoding("utf8");
                child.stdout.on("data", (chunk) => {
                    output += chunk;
                });
            }
            child.once("error", (error) => {
                console.error("[codex-task-companion] failed to start Windows window helper", error);
                finish();
            });
            child.once("close", finish);
            timeout = setTimeout(() => {
                child.kill();
                finish();
            }, 5000);
        }
        catch (error) {
            console.error("[codex-task-companion] Windows window helper threw", error);
            finish();
        }
    });
}
async function activateNotificationTarget(options, workspacePath, projectHint, capturedWindowHandle) {
    if (process.platform === "win32") {
        // Let Windows finish dispatching the toast activation before correcting
        // the foreground window. Otherwise its default Code.exe activation can
        // race us and put the last-used window back on top.
        await new Promise((resolve) => setTimeout(resolve, 75));
    }
    try {
        await options.focus?.();
    }
    catch (error) {
        console.error("[codex-task-companion] failed to focus notification target", error);
    }
    try {
        const focusResult = await focusVsCodeWindow(workspacePath, projectHint, originatingWindowHandle || capturedWindowHandle);
        notificationDiagnostics.lastFocusAt = new Date().toISOString();
        notificationDiagnostics.lastFocusResult = focusResult;
        notificationDiagnostics.lastTargetWindowHandle = originatingWindowHandle || capturedWindowHandle;
    }
    catch (error) {
        notificationDiagnostics.lastFocusAt = new Date().toISOString();
        notificationDiagnostics.lastFocusResult = `error:${String(error)}`;
        console.error("[codex-task-companion] failed to focus originating VS Code window", error);
    }
}
function showInEditor(title, message, level, onOpen) {
    const fullMessage = `${title}: ${message}`;
    const openAction = "打开";
    const result = level === "error"
        ? vscode.window.showErrorMessage(fullMessage, ...(onOpen ? [openAction] : []))
        : vscode.window.showInformationMessage(fullMessage, ...(onOpen ? [openAction] : []));
    if (onOpen) {
        void result.then((selected) => {
            if (selected === openAction)
                onOpen();
        });
    }
}
async function notifyDesktop(title, message, level = "info", kind = "codex", options = {}) {
    const mode = getMode();
    const channels = (0, notificationPolicy_1.notificationChannels)(mode, areDesktopNotificationsEnabled());
    if (!channels.desktop && !channels.editor)
        return deliveryResult(false, "suppressed-muted");
    if (shouldSuppressWhenFocused()) {
        return deliveryResult(false, "suppressed-focused");
    }
    if (options.deduplicationKey && notificationClaimStore) {
        try {
            if (!notificationClaimStore.claim(options.deduplicationKey)) {
                notificationDiagnostics.duplicateSuppressedCount += 1;
                return deliveryResult(false, "suppressed-duplicate");
            }
        }
        catch (error) {
            // Fail open so a storage problem cannot disable notifications entirely.
            console.error("[codex-task-companion] failed to claim notification event", error);
        }
    }
    const targetWorkspacePath = options.workspacePath ?? getWorkspacePath();
    const targetProjectHint = options.projectHint ?? getWorkspaceProjectName();
    if (process.platform === "win32" && !originatingWindowHandle && vscode.window.state.focused) {
        const handle = await captureForegroundVsCodeWindow();
        if (handle && vscode.window.state.focused)
            originatingWindowHandle = handle;
    }
    const targetWindowHandle = originatingWindowHandle;
    let targetActivationStarted = false;
    const openTarget = () => {
        if (targetActivationStarted)
            return;
        targetActivationStarted = true;
        void activateNotificationTarget(options, targetWorkspacePath, targetProjectHint, targetWindowHandle);
    };
    if (channels.editor) {
        showInEditor(title, message, level, openTarget);
    }
    if (!channels.desktop) {
        return deliveryResult(true, "vscode");
    }
    const iconPath = getNotificationIcon(kind);
    const notifier = getNativeNotifier();
    if (!notifier) {
        if (mode === "Desktop") {
            showInEditor(title, message, level, openTarget);
        }
        return deliveryResult(true, "vscode-fallback");
    }
    if (process.platform === "win32") {
        await windowsNotificationRegistration;
    }
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            notificationDiagnostics.lastDeliveryOutcome = result.outcome;
            resolve(result);
        };
        try {
            // On Windows node-notifier uses SnoreToast. Passing `icon` maps to the
            // native toast image (`-p`), which supports the image-left/text-right
            // layout. Passing `appName` maps to the registered Toast AppID, so
            // Windows shows Notifyer instead of the SnoreToast helper name.
            const notificationOptions = {
                // SnoreToast supplies a default title when the value is empty. A
                // whitespace title keeps that default from appearing while leaving
                // the registered Notifyer app identity intact.
                title: process.platform === "win32" && options.hideTitle ? " " : title,
                message,
                wait: shouldOpenVsCodeOnClick(),
                icon: iconPath,
                ...(process.platform === "win32" ? { appName: NOTIFYER_APP_ID } : {}),
            };
            notifier.notify(notificationOptions, (error, response, metadata) => {
                if (error) {
                    console.error("[codex-task-companion] desktop notification failed", error);
                    if (mode === "Desktop") {
                        showInEditor(title, message, level, openTarget);
                    }
                    finish({ delivered: true, outcome: "vscode-fallback" });
                    return;
                }
                notificationDiagnostics.lastCallbackAt = new Date().toISOString();
                notificationDiagnostics.lastResponse = response ?? "";
                notificationDiagnostics.lastActivationType = typeof metadata?.activationType === "string"
                    ? metadata.activationType
                    : "";
                notificationDiagnostics.lastActivationValue = typeof metadata?.activationValue === "string"
                    ? metadata.activationValue
                    : "";
                const wasClicked = (0, core_1.isDesktopNotificationActivation)(response, metadata?.activationType, metadata?.activationValue, metadata?.action, metadata?.button, metadata?.activationAt);
                if (shouldOpenVsCodeOnClick() && wasClicked) {
                    notificationDiagnostics.clickCount += 1;
                    notificationDiagnostics.lastClickAt = new Date().toISOString();
                    openTarget();
                }
                finish({ delivered: true, outcome: "notified" });
            });
            setTimeout(() => finish({ delivered: true, outcome: "notified" }), 1000);
        }
        catch (error) {
            console.error("[codex-task-companion] desktop notification threw", error);
            if (mode === "Desktop") {
                showInEditor(title, message, level, openTarget);
            }
            finish({ delivered: true, outcome: "vscode-fallback" });
        }
    });
}
function deliveryResult(delivered, outcome) {
    notificationDiagnostics.lastDeliveryOutcome = outcome;
    return { delivered, outcome };
}
