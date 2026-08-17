import * as vscode from "vscode";
import { DEFAULT_PYTHON_COMMAND_PATTERN, isPythonCommand, truncate } from "./core";
import { notifyDesktop } from "./notify";

interface TerminalWindowWithShellEvents {
  onDidEndTerminalShellExecution?: vscode.Event<vscode.TerminalShellExecutionEndEvent>;
}

export class PythonTerminalMonitor implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private enabled = true;
  private notifyOnFailure = true;
  private pattern = DEFAULT_PYTHON_COMMAND_PATTERN;
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
      pattern: this.pattern,
      notifyOnFailure: this.notifyOnFailure,
    };
  }

  public dispose(): void {
    for (const disposable of this.disposables) disposable.dispose();
  }

  private reloadConfiguration(): void {
    const config = vscode.workspace.getConfiguration("codexTaskCompanion.terminal");
    this.enabled = config.get<boolean>("enabled", true);
    this.notifyOnFailure = config.get<boolean>("notifyOnFailure", true);
    this.pattern = config.get<string>("pythonCommandPattern", DEFAULT_PYTHON_COMMAND_PATTERN);
    this.cooldownMs = Math.max(0, config.get<number>("cooldownMs", 1500));
  }

  private handleEnd(event: vscode.TerminalShellExecutionEndEvent): void {
    if (!this.enabled) return;
    const commandLine = getCommandLine(event.execution.commandLine);
    if (!isPythonCommand(commandLine, this.pattern)) return;

    const exitCode = event.exitCode;
    if (!this.notifyOnFailure && exitCode !== 0) return;

    const terminalKey = event.terminal as unknown as object;
    const now = Date.now();
    const previous = this.lastNotificationByTerminal.get(terminalKey) ?? 0;
    if (now - previous < this.cooldownMs) return;
    this.lastNotificationByTerminal.set(terminalKey, now);

    const success = exitCode === 0;
    const status = exitCode === undefined ? "退出码未知" : `退出码 ${exitCode}`;
    const title = success ? "Python 任务已完成" : "Python 任务失败";
    const message = `${event.terminal.name} · ${status}\n${truncate(commandLine, 220)}`;
    void notifyDesktop(title, message, success ? "info" : "error", "terminal");
  }
}

function getCommandLine(commandLine: vscode.TerminalShellExecutionCommandLine | string): string {
  return typeof commandLine === "string" ? commandLine : commandLine.value;
}
