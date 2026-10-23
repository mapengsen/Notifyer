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
exports.TerminalMonitor = void 0;
const vscode = __importStar(require("vscode"));
const core_1 = require("./core");
const notify_1 = require("./notify");
class TerminalMonitor {
    disposables = [];
    enabled = true;
    pythonOnly = true;
    notifyOnFailure = true;
    ignoredCommands = core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS;
    cooldownMs = 1500;
    lastNotificationByTerminal = new WeakMap();
    supported = false;
    constructor() {
        this.reloadConfiguration();
        const windowApi = vscode.window;
        if (windowApi.onDidEndTerminalShellExecution) {
            this.supported = true;
            this.disposables.push(windowApi.onDidEndTerminalShellExecution((event) => this.handleEnd(event)));
        }
        this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration("codexTaskCompanion.terminal")) {
                this.reloadConfiguration();
            }
        }));
    }
    getDiagnostics() {
        return {
            enabled: this.enabled,
            supported: this.supported,
            pythonOnly: this.pythonOnly,
            ignoredCommands: this.ignoredCommands,
            notifyOnFailure: this.notifyOnFailure,
        };
    }
    dispose() {
        for (const disposable of this.disposables)
            disposable.dispose();
    }
    reloadConfiguration() {
        const config = vscode.workspace.getConfiguration("codexTaskCompanion.terminal");
        this.enabled = config.get("enabled", true);
        this.pythonOnly = config.get("pythonOnly", true);
        this.notifyOnFailure = config.get("notifyOnFailure", true);
        const configuredIgnoredCommands = config.get("ignoredCommands", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS);
        this.ignoredCommands = Array.isArray(configuredIgnoredCommands) &&
            configuredIgnoredCommands.every((command) => typeof command === "string")
            ? configuredIgnoredCommands
            : core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS;
        this.cooldownMs = Math.max(0, config.get("cooldownMs", 1500));
    }
    handleEnd(event) {
        if (!this.enabled)
            return;
        const commandLine = getCommandLine(event.execution.commandLine);
        if (!(0, core_1.shouldNotifyTerminalCommand)(commandLine, this.ignoredCommands, this.pythonOnly))
            return;
        const exitCode = event.exitCode;
        if (!this.notifyOnFailure && exitCode !== 0)
            return;
        const terminalKey = event.terminal;
        const now = Date.now();
        const previous = this.lastNotificationByTerminal.get(terminalKey) ?? 0;
        if (now - previous < this.cooldownMs)
            return;
        this.lastNotificationByTerminal.set(terminalKey, now);
        const success = exitCode === 0;
        const status = exitCode === undefined ? "退出码未知" : `退出码 ${exitCode}`;
        const title = success ? "终端任务已完成" : "终端任务失败";
        const message = `${event.terminal.name} · ${status}\n${(0, core_1.truncate)(commandLine, 220)}`;
        void (0, notify_1.notifyDesktop)(title, message, success ? "info" : "error", "terminal", {
            focus: () => event.terminal.show(false),
        });
    }
}
exports.TerminalMonitor = TerminalMonitor;
function getCommandLine(commandLine) {
    return typeof commandLine === "string" ? commandLine : commandLine.value;
}
