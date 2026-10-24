import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as vscode from "vscode";
import { workspacePathsOverlap } from "./core";
import { areDesktopNotificationsEnabled, focusOriginatingWindow, getNotificationDiagnostics, notifyDesktop } from "./notify";
import { SessionActivity } from "./sessionActivity";
import { focusSession, SessionFocusRequest } from "./sessionFocus";
import { openSession } from "./sessionNavigator";
import { SessionViewMonitor } from "./sessionViewMonitor";
import { isPendingResult } from "./sessionSelection";
import { aggregateSessions, applyActivity, atomicWriteJson, digest, isPanelHealthy, panelVisibility, PanelHeartbeat, PanelVisibilityRequest, SessionNavigationDiagnostics, StoredSession, WindowSnapshot } from "./floatingState";

export class FloatingPanel implements vscode.Disposable {
  private readonly windowId = randomUUID();
  private readonly sessions = new Map<string, StoredSession>();
  private readonly root: string;
  private readonly timer: NodeJS.Timeout | undefined;
  private publishTimer: NodeJS.Timeout | undefined;
  private enabled = false;
  private disposed = false;
  private lastError = "";
  private lastLaunchAt = 0;
  private launchAttempts = 0;
  private lastExit = "";
  private existingHelperDetected = false;
  private focusGeneration = 0;
  private focusQueue: Promise<void> = Promise.resolve();
  private readonly viewMonitor: SessionViewMonitor | undefined;
  private lastNavigation: SessionNavigationDiagnostics | undefined;
  private readonly statusItem: vscode.StatusBarItem | undefined;
  private readonly statusTimer: NodeJS.Timeout | undefined;
  private readonly output = vscode.window.createOutputChannel("Notifyer Floating Window");

  public constructor(private readonly context: vscode.ExtensionContext) {
    this.root = path.join(context.globalStorageUri.fsPath, "floating-panel");
    if (process.platform !== "win32") return;
    this.statusItem = vscode.window.createStatusBarItem("codexTaskCompanion.floatingWindow", vscode.StatusBarAlignment.Right, 100);
    this.statusItem.name = "Notifyer 桌面悬浮窗";
    this.statusItem.command = "codexTaskCompanion.toggleFloatingWindow";
    this.updateStatusBar();
    this.statusItem.show();
    this.statusTimer = setInterval(() => this.updateStatusBar(), 500);
    this.restore();
    this.configure();
    this.timer = setInterval(() => this.tick(), 2000);
    this.viewMonitor = new SessionViewMonitor(context,
      () => this.enabled && !this.disposed ? [...this.sessions.values()] : [],
      (result) => this.safe(() => {
        if (!this.enabled || this.disposed || !isPendingResult(this.sessions.get(result.key), result)) return;
        const file = path.join(this.root, "read", `${result.acknowledgement}.json`);
        if (fs.existsSync(file)) return;
        atomicWriteJson(file, { at: Date.now(), source: "session-selected" });
        this.publishModel();
      }));
    context.subscriptions.push(
      vscode.commands.registerCommand("codexTaskCompanion.showFloatingWindow", () => this.open()),
      vscode.commands.registerCommand("codexTaskCompanion.hideFloatingWindow", () => this.command("hide")),
      vscode.commands.registerCommand("codexTaskCompanion.toggleFloatingWindow", () => {
        if (this.isVisible()) this.command("hide");
        else return this.open();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration("codexTaskCompanion.floatingWindow")) this.configure();
        for (const provider of ["codex", "claude"] as const) {
          if (event.affectsConfiguration(`codexTaskCompanion.${provider}.enabled`)
            && !vscode.workspace.getConfiguration(`codexTaskCompanion.${provider}`).get("enabled", true)) {
            for (const session of this.sessions.values()) {
              if (session.provider === provider && session.status === "running") session.status = "unknown";
            }
          }
        }
      }),
    );
  }

  public readonly accept = (activity: SessionActivity, remove = false): void => {
    if (process.platform !== "win32" || !this.enabled || this.disposed) return;
    if (remove) this.sessions.delete(activity.key);
    else {
      // Unknown workspace membership is not enough to claim a conversation.
      const folders = vscode.workspace.workspaceFolders ?? [];
      if (!activity.cwd || !folders.some((folder) => workspacePathsOverlap(
        folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path, activity.cwd,
      ))) return;
      const previous = this.sessions.get(activity.key);
      this.sessions.set(activity.key, applyActivity(previous, activity));
      const newQuestion = activity.attention?.requestIds.some((id) => !previous?.attention?.requestIds.includes(id));
      if (activity.live && newQuestion && activity.attention) {
        const newIds = activity.attention.requestIds.filter((id) => !previous?.attention?.requestIds.includes(id));
        // Allow immediately rejected/cancelled requests to settle before showing
        // an OS notification; the floating card follows the latest state too.
        setTimeout(() => {
          const latest = this.sessions.get(activity.key);
          if (this.disposed || !latest?.attention || !newIds.some((id) => latest.attention!.requestIds.includes(id))) return;
          void notifyDesktop(`有新问题 · ${vscode.workspace.name ?? "Notifyer"}`, latest.attention.message, "info", latest.provider, {
            workspacePath: latest.cwd,
            deduplicationKey: `question:${latest.key}:${newIds.join(",")}`,
            focus: async () => {
              const target = this.sessions.get(activity.key);
              if (target?.attention) await openSession(target, (value) => this.viewMonitor?.confirms(value) ?? false);
            },
          }).catch((error) => this.report(error));
        }, 200);
      }
    }
    if (!this.publishTimer) this.publishTimer = setTimeout(() => {
      this.publishTimer = undefined;
      this.safe(() => this.publish());
    }, 150);
  };

  public getDiagnostics(): Record<string, unknown> {
    let panelError = "";
    try { panelError = fs.readFileSync(path.join(this.root, "panel-error.log"), "utf8"); } catch {}
    return { supported: process.platform === "win32", enabled: this.enabled, extensionVersion: this.context.extension.packageJSON.version, root: this.root,
      windowId: this.windowId, sessionCount: this.sessions.size, lastError: this.lastError, panelError,
      helper: this.heartbeat(), helperHealthy: isPanelHealthy(this.heartbeat()), lastLaunchAt: this.lastLaunchAt,
      launchAttempts: this.launchAttempts, lastExit: this.lastExit, existingHelperDetected: this.existingHelperDetected,
      floatingWindowVisible: this.isVisible(), statusBarEntry: process.platform === "win32", sessionSelection: this.viewMonitor?.getDiagnostics(), navigation: this.lastNavigation };
  }
  public dispose(): void {
    this.disposed = true;
    if (this.timer) clearInterval(this.timer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.viewMonitor?.dispose();
    if (process.platform === "win32") this.safe(() => this.publish(true));
    this.output.dispose();
    this.statusItem?.dispose();
  }
  private configure(): void {
    const wasEnabled = this.enabled;
    this.enabled = vscode.workspace.getConfiguration("codexTaskCompanion.floatingWindow").get("enabled", true);
    // A transient snapshot replacement error must not skip the UI launch.
    this.safe(() => this.publish(!this.enabled));
    if (this.enabled && !wasEnabled) this.safe(() => {
      const request = this.visibilityRequest();
      // A hide click made while settings are being enabled must win.
      if (request?.type !== "hide" || Date.now() - request.requestedAt >= 10_000) this.show();
    });
    if (!this.enabled && wasEnabled) this.safe(() => { this.command("hide"); });
  }
  private snapshots(): WindowSnapshot[] {
    const folder = path.join(this.root, "windows");
    if (!fs.existsSync(folder)) return [];
    const values: WindowSnapshot[] = [];
    for (const name of fs.readdirSync(folder)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      try {
        const value = JSON.parse(fs.readFileSync(path.join(folder, name), "utf8")) as WindowSnapshot;
        if (value.version === 1 && Array.isArray(value.sessions)) values.push(value);
      } catch { /* Another host may be replacing a snapshot; retry next tick. */ }
    }
    return values;
  }
  private workspace(): string {
    return vscode.workspace.workspaceFile?.toString()
      ?? (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()).sort().join("|");
  }
  private restore(): void {
    this.safe(() => {
      for (const snapshot of this.snapshots()) {
        if (snapshot.workspace !== this.workspace() || !snapshot.workspace) continue;
        for (const session of snapshot.sessions) {
          if (!this.sessions.has(session.key) || this.sessions.get(session.key)!.updatedAt < session.updatedAt) {
            this.sessions.set(session.key, session);
          }
        }
      }
    });
  }
  private publish(closed = false): void {
    const snapshot: WindowSnapshot = {
      version: 1, windowId: this.windowId, workspace: this.workspace(),
      extensionVersion: this.context.extension.packageJSON.version,
      sessionSelection: this.viewMonitor?.getDiagnostics(), navigation: this.lastNavigation,
      project: vscode.workspace.name ?? "未打开文件夹",
      environment: vscode.env.remoteName ?? "本地",
      windowHandle: String(getNotificationDiagnostics().originatingWindowHandle ?? ""),
      pid: process.pid, heartbeat: Date.now(), closed, sessions: [...this.sessions.values()],
    };
    atomicWriteJson(path.join(this.root, "windows", `${this.windowId}.json`), snapshot);
    this.publishModel();
  }
  private publishModel(): void {
    const quietMinutes = Math.max(1, vscode.workspace.getConfiguration("codexTaskCompanion.floatingWindow")
      .get<number>("quietAfterMinutes", 30));
    const rows = aggregateSessions(this.snapshots(),
      (key) => fs.existsSync(path.join(this.root, "read", `${key}.json`)), Date.now(), quietMinutes * 60_000);
    atomicWriteJson(path.join(this.root, "model.json"), {
      rows, updatedAt: Date.now(), desktopNotificationsEnabled: areDesktopNotificationsEnabled(),
    });
  }
  private tick(): void {
    if (!this.enabled || this.disposed) return;
    this.safe(() => this.publish());
    this.safe(() => {
      if (isPanelHealthy(this.heartbeat())) this.launchAttempts = 0;
      else if (Date.now() - this.lastLaunchAt >= Math.min(120_000, 15_000 * 2 ** Math.min(this.launchAttempts, 3))) {
        this.launch();
      }
    });
    const commands = path.join(this.root, "commands", this.windowId);
    if (!fs.existsSync(commands)) return;
    const pending: Array<{ action: SessionFocusRequest; at: number }> = [];
    for (const name of fs.readdirSync(commands)) {
      if (!/^[a-f0-9-]+\.json$/.test(name)) continue;
      this.safe(() => {
        const file = path.join(commands, name);
        const action = JSON.parse(fs.readFileSync(file, "utf8")) as SessionFocusRequest;
        const at = Number.isFinite(action.requestedAt) ? action.requestedAt! : fs.statSync(file).mtimeMs;
        fs.unlinkSync(file);
        if (action.type === "focus") pending.push({ action, at });
      });
    }
    for (const { action } of pending.sort((a, b) => a.at - b.at)) {
      const generation = ++this.focusGeneration;
      this.focusQueue = this.focusQueue.then(async () => {
        if (this.disposed || generation !== this.focusGeneration) return;
        const result = await focusSession(action, {
          getSession: (key) => this.sessions.get(key),
          focusWindow: async () => {
            const result = await focusOriginatingWindow();
            if (result.startsWith("failed") || result === "unavailable") return false;
            for (let delay = 0; delay < 1000 && !vscode.window.state.focused && generation === this.focusGeneration; delay += 50) {
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
            }
            return vscode.window.state.focused;
          },
          openSession: async (session) => {
            try {
              return await openSession(session, (target) => this.viewMonitor?.confirms(target) ?? false,
                (diagnostics) => { this.lastNavigation = diagnostics; });
            } catch (error) { this.report(error); return false; }
          },
          isCurrentAndFocused: () => !this.disposed && generation === this.focusGeneration && vscode.window.state.focused,
          acknowledge: (key) => atomicWriteJson(path.join(this.root, "read", `${key}.json`), { at: Date.now(), source: "session-opened" }),
        });
        if (generation !== this.focusGeneration || this.disposed) return;
        this.publishModel();
        atomicWriteJson(path.join(this.root, "response.json"), { message: result === "failed" ? "无法切换窗口"
          : result === "window-only" && action.key ? this.lastNavigation?.phase === "sidebar-open-requested"
            ? "已请求在 Codex 侧边栏打开指定对话；未确认已查看，保留提醒"
            : "已返回窗口；未确认具体对话，保留待查看" : "", at: Date.now() });
      }).catch((error) => this.report(error));
    }
  }
  private command(type: "show" | "hide"): PanelVisibilityRequest {
    const request: PanelVisibilityRequest = { type, id: randomUUID(), requestedAt: Date.now() };
    atomicWriteJson(path.join(this.root, "control.json"), request);
    this.updateStatusBar();
    return request;
  }
  private async open(): Promise<void> {
    const request = this.command("show");
    if (!this.enabled) {
      await vscode.workspace.getConfiguration("codexTaskCompanion.floatingWindow")
        .update("enabled", true, vscode.ConfigurationTarget.Global);
      this.enabled = true;
    }
    if (this.visibilityRequest()?.type === "hide") return;
    this.safe(() => this.publish());
    if (!isPanelHealthy(this.heartbeat())) this.launch();
    const deadline = Date.now() + 10_000;
    while (!this.disposed && Date.now() < deadline && !isPanelHealthy(this.heartbeat()) && !this.existingHelperDetected) {
      if (this.visibilityRequest()?.type === "hide") return;
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
    }
    if (!this.disposed && !isPanelHealthy(this.heartbeat()) && !this.existingHelperDetected
      && this.visibilityRequest()?.id === request.id) {
      const selected = await vscode.window.showWarningMessage(
        "Notifyer 悬浮窗尚未启动，请查看诊断中的 floatingWindow 和启动日志。", "查看诊断",
      );
      if (selected) await vscode.commands.executeCommand("codexTaskCompanion.showDiagnostics");
    }
  }
  private visibilityRequest(): PanelVisibilityRequest | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.root, "control.json"), "utf8")) as PanelVisibilityRequest;
    } catch { return undefined; }
  }
  private isVisible(): boolean {
    return panelVisibility(this.heartbeat(), this.visibilityRequest());
  }
  private updateStatusBar(): void {
    if (!this.statusItem || this.disposed) return;
    const visible = this.isVisible();
    this.statusItem.text = `${visible ? "$(eye)" : "$(eye-closed)"} Notifyer`;
    this.statusItem.tooltip = visible ? "Notifyer：点击隐藏桌面悬浮窗" : "Notifyer：点击显示桌面悬浮窗";
    this.statusItem.accessibilityInformation = { label: this.statusItem.tooltip, role: "button" };
  }
  private show(): void {
    this.command("show");
    if (!isPanelHealthy(this.heartbeat())) this.launch();
  }
  private heartbeat(): PanelHeartbeat | undefined {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.root, "panel-heartbeat.json"), "utf8")) as PanelHeartbeat;
    } catch { return undefined; }
  }
  private launch(): void {
    this.lastLaunchAt = Date.now();
    this.launchAttempts += 1;
    this.existingHelperDetected = false;
    const executable = path.join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows",
      "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    this.output.appendLine(`${new Date().toISOString()} Starting floating window (attempt ${this.launchAttempts})`);
    const child = spawn(executable, ["-NoProfile", "-STA", "-WindowStyle", "Hidden",
      "-ExecutionPolicy", "Bypass", "-File", path.join(this.context.extensionPath, "resources", "floating-panel.ps1"),
      "-StateRoot", this.root, "-InstanceKey", digest(this.root).slice(0, 24)],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (value: string) => {
      if (this.disposed) return;
      if (value.includes("instance=already-running")) this.existingHelperDetected = true;
      this.output.appendLine(value.trim());
    });
    child.stderr?.on("data", (value: string) => { if (!this.disposed) this.report(value.trim()); });
    child.on("exit", (code, signal) => {
      if (this.disposed) return;
      this.lastExit = `code=${code};signal=${signal ?? ""}`;
      this.output.appendLine(`${new Date().toISOString()} Floating window helper exited (${this.lastExit})`);
    });
    child.on("error", (error) => this.report(error));
    child.unref();
  }
  private safe(action: () => void): void {
    try { action(); } catch (error) { this.report(error); }
  }
  private report(error: unknown): void {
    this.lastError = error instanceof Error ? error.message : String(error);
    this.output.appendLine(`${new Date().toISOString()} ${this.lastError}`);
  }
}
