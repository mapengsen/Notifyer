import * as vscode from "vscode";
import { DEFAULT_IGNORED_TERMINAL_COMMANDS, shouldNotifyTerminalCommand, truncate } from "./core";
import { notifyDesktop } from "./notify";

interface TerminalWindowWithShellEvents {
  onDidEndTerminalShellExecution?: vscode.Event<vscode.TerminalShellExecutionEndEvent>;
}

export class TerminalMonitor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private enabled = true;
  private pythonOnly = true;
  private notifyOnFailure = true;
  private ignoredCommands: readonly string[] = DEFAULT_IGNORED_TERMINAL_COMMANDS;
  private cooldownMs = 1500;
  private lastNotificationByTerminal = new WeakMap<object, number>();
  private supported = false;

  public constructor() {
    this.reloadConfiguration();
    const windowApi = vscode.window as typeof vscode.window & TerminalWindowWithShellEvents;
    if (windowApi.onDidEndTerminalShellExecution) {
      this.supported = true;
      this.disposables.push(windowApi.onDidEndTerminalShellExecution((event) => this.handleEnd(event)));
    }
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexTaskCompanion.terminal")) {
          this.reloadConfiguration();
        }
      }),
    );
  }

  public getDiagnostics(): Record<string, unknown> {
    return {
      enabled: this.enabled,
      supported: this.supported,
      pythonOnly: this.pythonOnly,
      ignoredCommands: this.ignoredCommands,
      notifyOnFailure: this.notifyOnFailure,
    };
  }

  public dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }

  private reloadConfiguration(): void {
    const config = vscode.workspace.getConfiguration("codexTaskCompanion.terminal");
    this.enabled = config.get<boolean>("enabled", true);
    this.pythonOnly = config.get<boolean>("pythonOnly", true);
    this.notifyOnFailure = config.get<boolean>("notifyOnFailure", true);
    const configuredIgnoredCommands = config.get<unknown>("ignoredCommands", DEFAULT_IGNORED_TERMINAL_COMMANDS);
    this.ignoredCommands = Array.isArray(configuredIgnoredCommands) &&
      configuredIgnoredCommands.every((command) => typeof command === "string")
      ? configuredIgnoredCommands
      : DEFAULT_IGNORED_TERMINAL_COMMANDS;
    this.cooldownMs = Math.max(0, config.get<number>("cooldownMs", 1500));
  }

  private handleEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    if (!this.enabled) return;
    const commandLine = getCommandLine(event.execution.commandLine);
    if (!shouldNotifyTerminalCommand(commandLine, this.ignoredCommands, this.pythonOnly)) return;

    const exitCode = event.exitCode;
    if (!this.notifyOnFailure && exitCode !== 0) return;

    const terminalKey = event.terminal as unknown as object;
    const now = Date.now();
    const previous = this.lastNotificationByTerminal.get(terminalKey) ?? 0;
    if (now - previous < this.cooldownMs) return;
    this.lastNotificationByTerminal.set(terminalKey, now);

    const success = exitCode === 0;
    const status = exitCode === undefined ? "退出码未知" : `退出码 ${exitCode}`;
    const title = success ? "终端任务已完成" : "终端任务失败";
    const message = `${event.terminal.name} · ${status}\n${truncate(commandLine, 220)}`;
    void notifyDesktop(title, message, success ? "info" : "error", "terminal", {
      focus: () => event.terminal.show(false),
    });
  }
}

function getCommandLine(commandLine: vscode.TerminalShellExecutionCommandLine | string): string {
  return typeof commandLine === "string" ? commandLine : commandLine.value;
}
