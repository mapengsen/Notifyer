import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export type NotificationLevel = "info" | "error";
export type NotificationKind = "codex" | "claude" | "terminal";

export interface DesktopNotificationOptions {
  hideTitle?: boolean;
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

export function initializeNotifications(context: vscode.ExtensionContext): void {
  extensionContext = context;
  windowsNotificationRegistration = registerWindowsNotificationApp(context);
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

function focusVsCodeWindow(): void {
  void vscode.commands.executeCommand("workbench.action.focusFirstGroup");
  if (process.platform !== "win32" || !extensionContext) return;

  const scriptPath = path.join(extensionContext.extensionPath, "resources", "focus-vscode.ps1");
  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    scriptPath,
    "-ProjectHint",
    getWorkspaceProjectName(),
  ];
  try {
    const child = spawn("powershell.exe", args, {
      windowsHide: true,
      stdio: "ignore",
    });
    child.once("error", (error) => {
      console.error("[codex-task-companion] failed to focus VS Code window", error);
    });
    child.unref();
  } catch (error) {
    console.error("[codex-task-companion] failed to start VS Code focus helper", error);
  }
}

function showInEditor(title: string, message: string, level: NotificationLevel): void {
  const fullMessage = `${title}: ${message}`;
  if (level === "error") {
    void vscode.window.showErrorMessage(fullMessage);
  } else {
    void vscode.window.showInformationMessage(fullMessage);
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
  if (mode === "VS Code" || mode === "Both") {
    showInEditor(title, message, level);
  }

  if (mode === "VS Code") {
    return true;
  }

  const iconPath = getNotificationIcon(kind);

  const notifier = getNativeNotifier();
  if (!notifier) {
    if (mode === "Desktop") {
      showInEditor(title, message, level);
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
            showInEditor(title, message, level);
          }
          finish(false);
          return;
        }
        const wasClicked = response === "activate" || response === "click" ||
          metadata?.activationType === "clicked" || metadata?.activationType === "activate";
        if (shouldOpenVsCodeOnClick() && wasClicked) {
          focusVsCodeWindow();
        }
        finish(true);
      });
      setTimeout(() => finish(true), 1000);
    } catch (error) {
      console.error("[codex-task-companion] desktop notification threw", error);
      if (mode === "Desktop") {
        showInEditor(title, message, level);
      }
      finish(false);
    }
  });
}
