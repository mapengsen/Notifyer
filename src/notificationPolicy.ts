import * as fs from "node:fs";

export function readDesktopNotificationPolicy(file: string | undefined): boolean {
  if (!file) return true;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as { desktopEnabled?: unknown };
    return value.desktopEnabled !== false;
  } catch { return true; }
}

export function notificationChannels(mode: "Desktop" | "VS Code" | "Both", desktopEnabled: boolean): {
  desktop: boolean; editor: boolean;
} {
  return { desktop: desktopEnabled && mode !== "VS Code", editor: mode !== "Desktop" };
}
