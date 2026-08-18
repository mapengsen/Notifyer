import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export type NotificationLevel = "info" | "error";
export type NotificationKind = "codex" | "claude" | "terminal";

export interface DesktopNotificationOptions {
  hideTitle?: boolean;
  /** Select the originating editor/terminal when the desktop notification is clicked. */
  focus?: () => void | Thenable<void>;
  /** Optional workspace path captured when the notification is created. */
  workspacePath?: string;
  /** Optional project name used as a fallback for window matching. */
  projectHint?: string;
}

const NOTIFYER_APP_ID = "Notifyer";

interface NativeNotifier {
  notify(options: {
    title: string;
    message: string;
    wait?: boolean;
    icon?: string;
    appName?: string;
  }, callback?: (error: Error | null, response?: string, metadata?: Record<string, unknown>) => void): void;
}

let extensionContext: vscode.ExtensionContext | undefined;
let windowsNotificationRegistration: Promise<void> | undefined;
let originatingWindowHandle = "";
let windowCaptureGeneration = 0;

export function initializeNotifications(context: vscode.ExtensionContext): void {
  extensionContext = context;
  windowsNotificationRegistration = registerWindowsNotificationApp(context);
  if (process.platform !== "win32") return;

  context.subscriptions.push(
    vscode.window.onDidChangeWindowState((state) => {
      trackOriginatingWindow(state.focused);
    }),
  );
  trackOriginatingWindow(vscode.window.state.focused);
}

export async function focusClaudePage(): Promise<void> {
  await runFirstAvailableCommand([
    "claude-code-chat.openChat",
    "workbench.action.chat.open",
    "workbench.action.terminal.focus",
  ]);
}

async function runFirstAvailableCommand(commands: readonly string[]): Promise<void> {
  for (const command of commands) {
    try {
      await vscode.commands.executeCommand(command);
      return;
    } catch {
      // Try the next command contributed by a compatible extension/version.
    }
  }
}

function trackOriginatingWindow(focused: boolean): void {
  const generation = ++windowCaptureGeneration;
  if (!focused) return;

  void captureForegroundVsCodeWindow().then((handle) => {
    if (!handle || generation !== windowCaptureGeneration || !vscode.window.state.focused) return;
    originatingWindowHandle = handle;
  });
}

function registerWindowsNotificationApp(context: vscode.ExtensionContext): Promise<void> {
  if (process.platform !== "win32") return Promise.resolve();

  const appData = process.env.APPDATA;
  if (!appData) return Promise.resolve();

  const architecture = process.arch === "x64" ? "x64" : "x86";
  const snoreToastPath = path.join(
    context.extensionPath,
    "node_modules",
    "node-notifier",
    "vendor",
    "snoreToast",
    `snoretoast-${architecture}.exe`,
  );
  if (!fs.existsSync(snoreToastPath)) {
    console.error("[codex-task-companion] SnoreToast binary was not found", snoreToastPath);
    return Promise.resolve();
  }

  const shortcutPath = path.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Notifyer.lnk",
  );
  if (fs.existsSync(shortcutPath)) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      const child = spawn(
        snoreToastPath,
        ["-install", shortcutPath, process.env.VSCODE_EXEC_PATH || process.execPath, NOTIFYER_APP_ID],
        { windowsHide: true, stdio: "ignore" },
      );
      child.once("error", (error) => {
        console.error("[codex-task-companion] failed to register Notifyer Windows app", error);
        finish();
      });
      child.once("close", finish);
      setTimeout(finish, 5000);
    } catch (error) {
      console.error("[codex-task-companion] failed to start Notifyer Windows app registration", error);
      finish();
    }
  });
}

function getNativeNotifier(): NativeNotifier | undefined {
  try {
    const loaded = require("node-notifier") as NativeNotifier | { default?: NativeNotifier };
    return "notify" in loaded ? loaded : loaded.default;
  } catch {
    return undefined;
  }
}

function getMode(): "Desktop" | "VS Code" | "Both" {
  const configured = vscode.workspace
    .getConfiguration("codexTaskCompanion.notifications")
    .get<string>("mode", "Desktop");
  return configured === "VS Code" || configured === "Both" ? configured : "Desktop";
}

function shouldSuppressWhenFocused(): boolean {
  return vscode.workspace
    .getConfiguration("codexTaskCompanion.notifications")
    .get<boolean>("onlyWhenWindowUnfocused", false) && vscode.window.state.focused;
}

function shouldOpenVsCodeOnClick(): boolean {
  return vscode.workspace
    .getConfiguration("codexTaskCompanion.notifications")
    .get<boolean>("openVsCodeOnClick", true);
}

function getWorkspaceProjectName(): string {
  return vscode.workspace.workspaceFolders?.[0]?.name ?? "";
}

function getWorkspacePath(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return "";
  return folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path;
}

function getNotificationIcon(kind: NotificationKind): string | undefined {
  if (!extensionContext) return undefined;
  return path.join(
    extensionContext.extensionPath,
    "resources",
    "images",
    kind === "terminal"
      ? "terminal.png"
      : kind === "claude"
        ? "claude.png"
        : "blossom.dark.png",
  );
}

async function captureForegroundVsCodeWindow(): Promise<string | undefined> {
  if (process.platform !== "win32" || !extensionContext) return undefined;

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

async function focusVsCodeWindow(
  workspacePath: string,
  projectHint: string,
  windowHandle: string,
): Promise<void> {
  if (await focusCurrentWorkbenchWindow()) return;
  if (process.platform !== "win32" || !extensionContext) return;

  const scriptPath = path.join(extensionContext.extensionPath, "resources", "focus-vscode.ps1");
  await runPowerShellScript(scriptPath, [
    "-WindowHandle",
    windowHandle || "0",
    "-ProjectHint",
    projectHint,
    "-WorkspacePath",
    workspacePath,
    "-SourceProcessId",
    String(process.pid),
  ], false);
}

async function focusCurrentWorkbenchWindow(): Promise<boolean> {
  if (vscode.window.state.focused) return true;
  try {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes("workbench.action.focusWindow")) return false;
    await vscode.commands.executeCommand("workbench.action.focusWindow");
    if (!vscode.window.state.focused) {
      await new Promise<void>((resolve) => setTimeout(resolve, 75));
    }
    return vscode.window.state.focused;
  } catch {
    return false;
  }
}

function runPowerShellScript(
  scriptPath: string,
  scriptArgs: readonly string[],
  captureOutput: boolean,
): Promise<string> {
  return new Promise<string>((resolve) => {
    let settled = false;
    let output = "";
    let timeout: NodeJS.Timeout | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(output);
    };

    try {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...scriptArgs],
        {
          windowsHide: true,
          stdio: captureOutput ? ["ignore", "pipe", "ignore"] : "ignore",
        },
      );
      if (captureOutput && child.stdout) {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
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
    } catch (error) {
      console.error("[codex-task-companion] Windows window helper threw", error);
      finish();
    }
  });
}

async function activateNotificationTarget(
  options: DesktopNotificationOptions,
  workspacePath: string,
  projectHint: string,
  capturedWindowHandle: string,
): Promise<void> {
  if (process.platform === "win32") {
    // Let Windows finish dispatching the toast activation before correcting
    // the foreground window. Otherwise its default Code.exe activation can
    // race us and put the last-used window back on top.
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
  }

  try {
    await options.focus?.();
  } catch (error) {
    console.error("[codex-task-companion] failed to focus notification target", error);
  }

  try {
    await focusVsCodeWindow(
      workspacePath,
      projectHint,
      originatingWindowHandle || capturedWindowHandle,
    );
  } catch (error) {
    console.error("[codex-task-companion] failed to focus originating VS Code window", error);
  }
}

function showInEditor(
  title: string,
  message: string,
  level: NotificationLevel,
  onOpen?: () => void,
): void {
  const fullMessage = `${title}: ${message}`;
  const openAction = "打开";
  const result = level === "error"
    ? vscode.window.showErrorMessage(fullMessage, ...(onOpen ? [openAction] : []))
    : vscode.window.showInformationMessage(fullMessage, ...(onOpen ? [openAction] : []));
  if (onOpen) {
    void result.then((selected) => {
      if (selected === openAction) onOpen();
    });
  }
}

export async function notifyDesktop(
  title: string,
  message: string,
  level: NotificationLevel = "info",
  kind: NotificationKind = "codex",
  options: DesktopNotificationOptions = {},
): Promise<boolean> {
  if (shouldSuppressWhenFocused()) {
    return false;
  }

  const mode = getMode();
  const targetWorkspacePath = options.workspacePath ?? getWorkspacePath();
  const targetProjectHint = options.projectHint ?? getWorkspaceProjectName();
  if (process.platform === "win32" && !originatingWindowHandle && vscode.window.state.focused) {
    const handle = await captureForegroundVsCodeWindow();
    if (handle && vscode.window.state.focused) originatingWindowHandle = handle;
  }
  const targetWindowHandle = originatingWindowHandle;
  const openTarget = () => {
    void activateNotificationTarget(
      options,
      targetWorkspacePath,
      targetProjectHint,
      targetWindowHandle,
    );
  };
  if (mode === "VS Code" || mode === "Both") {
    showInEditor(title, message, level, openTarget);
  }

  if (mode === "VS Code") {
    return true;
  }

  const iconPath = getNotificationIcon(kind);

  const notifier = getNativeNotifier();
  if (!notifier) {
    if (mode === "Desktop") {
      showInEditor(title, message, level, openTarget);
    }
    return false;
  }

  if (process.platform === "win32") {
    await windowsNotificationRegistration;
  }

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      resolve(success);
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
          finish(false);
          return;
        }
        const normalizedResponse = response?.toLowerCase();
        const normalizedActivation = typeof metadata?.activationType === "string"
          ? metadata.activationType.toLowerCase()
          : undefined;
        const wasClicked = normalizedResponse === "activate" || normalizedResponse === "click" ||
          normalizedResponse === "clicked" || normalizedActivation === "activate" ||
          normalizedActivation === "click" || normalizedActivation === "clicked";
        if (shouldOpenVsCodeOnClick() && wasClicked) {
          openTarget();
        }
        finish(true);
      });
      setTimeout(() => finish(true), 1000);
    } catch (error) {
      console.error("[codex-task-companion] desktop notification threw", error);
      if (mode === "Desktop") {
        showInEditor(title, message, level, openTarget);
      }
      finish(false);
    }
  });
}
