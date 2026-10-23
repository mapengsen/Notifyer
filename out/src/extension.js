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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const claudeSessionMonitor_1 = require("./claudeSessionMonitor");
const sessionMonitor_1 = require("./sessionMonitor");
const notify_1 = require("./notify");
const terminalMonitor_1 = require("./terminalMonitor");
const floatingPanel_1 = require("./floatingPanel");
function activate(context) {
    (0, notify_1.initializeNotifications)(context);
    const floatingPanel = new floatingPanel_1.FloatingPanel(context);
    const sessionMonitor = new sessionMonitor_1.CodexSessionMonitor(floatingPanel.accept);
    const claudeSessionMonitor = new claudeSessionMonitor_1.ClaudeSessionMonitor(floatingPanel.accept);
    const terminalMonitor = new terminalMonitor_1.TerminalMonitor();
    const diagnostics = vscode.window.createOutputChannel("Notifyer");
    context.subscriptions.push(floatingPanel, sessionMonitor, claudeSessionMonitor, terminalMonitor, diagnostics, vscode.commands.registerCommand("codexTaskCompanion.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "codexTaskCompanion")), vscode.commands.registerCommand("codexTaskCompanion.testNotification", () => (0, notify_1.notifyDesktop)("Notifyer", "桌面通知链路正常。")), vscode.commands.registerCommand("codexTaskCompanion.showDiagnostics", () => {
        diagnostics.clear();
        diagnostics.appendLine("Notifyer diagnostics");
        diagnostics.appendLine(JSON.stringify({
            session: sessionMonitor.getDiagnostics(),
            claudeSession: claudeSessionMonitor.getDiagnostics(),
            terminal: terminalMonitor.getDiagnostics(),
            notifications: (0, notify_1.getNotificationDiagnostics)(),
            floatingWindow: floatingPanel.getDiagnostics(),
            remoteName: vscode.env.remoteName ?? "",
        }, null, 2));
        diagnostics.show(true);
    }), vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexTaskCompanion.codex.sessionPollMs") ||
            event.affectsConfiguration("codexTaskCompanion.codex.sessionLookbackDays") ||
            event.affectsConfiguration("codexTaskCompanion.codex.sessionsRoot") ||
            event.affectsConfiguration("codexTaskCompanion.codex.enabled") ||
            event.affectsConfiguration("codexTaskCompanion.codex.notifyInitialScan") ||
            event.affectsConfiguration("codexTaskCompanion.floatingWindow.enabled")) {
            void sessionMonitor.restart();
        }
        if (event.affectsConfiguration("codexTaskCompanion.claude.sessionPollMs") ||
            event.affectsConfiguration("codexTaskCompanion.claude.sessionLookbackDays") ||
            event.affectsConfiguration("codexTaskCompanion.claude.projectsRoot") ||
            event.affectsConfiguration("codexTaskCompanion.claude.enabled") ||
            event.affectsConfiguration("codexTaskCompanion.claude.notifyInitialScan") ||
            event.affectsConfiguration("codexTaskCompanion.floatingWindow.enabled")) {
            void claudeSessionMonitor.restart();
        }
    }));
    void sessionMonitor.start();
    void claudeSessionMonitor.start();
}
function deactivate() {
    // VS Code disposes subscriptions registered by activate().
}
