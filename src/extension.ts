import * as vscode from "vscode";
import { ClaudeSessionMonitor } from "./claudeSessionMonitor";
import { ClaudeUsageMonitor } from "./claudeUsage";
import { CodexSessionMonitor } from "./sessionMonitor";
import { initializeNotifications, notifyDesktop } from "./notify";
import { PythonTerminalMonitor } from "./terminalMonitor";
import { UsageMonitor } from "./usage";

export function activate(context: vscode.ExtensionContext): void {
  initializeNotifications(context);
  const sessionMonitor = new CodexSessionMonitor();
  const usageMonitor = new UsageMonitor();
  const claudeSessionMonitor = new ClaudeSessionMonitor();
  const claudeUsageMonitor = new ClaudeUsageMonitor();
  const terminalMonitor = new PythonTerminalMonitor();
  const diagnostics = vscode.window.createOutputChannel("Notifyer");

  context.subscriptions.push(
    sessionMonitor,
    usageMonitor,
    claudeSessionMonitor,
    claudeUsageMonitor,
    terminalMonitor,
    diagnostics,
    vscode.commands.registerCommand("codexTaskCompanion.refreshUsage", () => usageMonitor.refresh()),
    vscode.commands.registerCommand("codexTaskCompanion.chooseUsageDisplayMode", () => usageMonitor.chooseDisplayMode()),
    vscode.commands.registerCommand("codexTaskCompanion.refreshClaudeUsage", () => claudeUsageMonitor.refresh()),
    vscode.commands.registerCommand("codexTaskCompanion.chooseClaudeUsageDisplayMode", () => claudeUsageMonitor.chooseDisplayMode()),
    vscode.commands.registerCommand("codexTaskCompanion.openSettings", () =>
      vscode.commands.executeCommand("workbench.action.openSettings", "codexTaskCompanion"),
    ),
    vscode.commands.registerCommand("codexTaskCompanion.testNotification", () =>
      notifyDesktop("Notifyer", "桌面通知链路正常。"),
    ),
    vscode.commands.registerCommand("codexTaskCompanion.showDiagnostics", () => {
      diagnostics.clear();
      diagnostics.appendLine("Notifyer diagnostics");
      diagnostics.appendLine(JSON.stringify({
        session: sessionMonitor.getDiagnostics(),
        usage: usageMonitor.getDiagnostics(),
        claudeSession: claudeSessionMonitor.getDiagnostics(),
        claudeUsage: claudeUsageMonitor.getDiagnostics(),
        terminal: terminalMonitor.getDiagnostics(),
        remoteName: vscode.env.remoteName ?? "",
      }, null, 2));
      diagnostics.show(true);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("codexTaskCompanion.codex.sessionPollMs") ||
          event.affectsConfiguration("codexTaskCompanion.codex.sessionLookbackDays") ||
          event.affectsConfiguration("codexTaskCompanion.codex.sessionsRoot") ||
          event.affectsConfiguration("codexTaskCompanion.codex.enabled")) {
        void sessionMonitor.restart();
      }
      if (event.affectsConfiguration("codexTaskCompanion.codex.usageUpdateIntervalSeconds") ||
          event.affectsConfiguration("codexTaskCompanion.codex.usageDisplayMode")) {
        usageMonitor.reloadConfiguration();
      }
      if (event.affectsConfiguration("codexTaskCompanion.claude.sessionPollMs") ||
          event.affectsConfiguration("codexTaskCompanion.claude.sessionLookbackDays") ||
          event.affectsConfiguration("codexTaskCompanion.claude.projectsRoot") ||
          event.affectsConfiguration("codexTaskCompanion.claude.enabled") ||
          event.affectsConfiguration("codexTaskCompanion.claude.notifyInitialScan")) {
        void claudeSessionMonitor.restart();
      }
      if (event.affectsConfiguration("codexTaskCompanion.claude.usageUpdateIntervalSeconds") ||
          event.affectsConfiguration("codexTaskCompanion.claude.usageDisplayMode")) {
        claudeUsageMonitor.reloadConfiguration();
      }
    }),
  );

  usageMonitor.start();
  claudeUsageMonitor.start();
  void sessionMonitor.start();
  void claudeSessionMonitor.start();
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered by activate().
}
