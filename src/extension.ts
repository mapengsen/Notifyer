import * as vscode from "vscode";
import { ClaudeSessionMonitor } from "./claudeSessionMonitor";
import { CodexSessionMonitor } from "./sessionMonitor";
import { initializeNotifications, notifyDesktop } from "./notify";
import { TerminalMonitor } from "./terminalMonitor";

export function activate(context: vscode.ExtensionContext): void {
  initializeNotifications(context);
  const sessionMonitor = new CodexSessionMonitor();
  const claudeSessionMonitor = new ClaudeSessionMonitor();
  const terminalMonitor = new TerminalMonitor();
  const diagnostics = vscode.window.createOutputChannel("Notifyer");

  context.subscriptions.push(
    sessionMonitor,
    claudeSessionMonitor,
    terminalMonitor,
    diagnostics,
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
        claudeSession: claudeSessionMonitor.getDiagnostics(),
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
      if (event.affectsConfiguration("codexTaskCompanion.claude.sessionPollMs") ||
          event.affectsConfiguration("codexTaskCompanion.claude.sessionLookbackDays") ||
          event.affectsConfiguration("codexTaskCompanion.claude.projectsRoot") ||
          event.affectsConfiguration("codexTaskCompanion.claude.enabled") ||
          event.affectsConfiguration("codexTaskCompanion.claude.notifyInitialScan")) {
        void claudeSessionMonitor.restart();
      }
    }),
  );

  void sessionMonitor.start();
  void claudeSessionMonitor.start();
}

export function deactivate(): void {
  // VS Code disposes subscriptions registered by activate().
}
