import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import * as vscode from "vscode";

const execFileAsync = promisify(execFile);

export async function findRemoteHome(
  reference: vscode.Uri,
  credentialSegments: string[],
): Promise<vscode.Uri | undefined> {
  const candidates = new Set<string>();
  const inferred = reference.path.match(/^\/(home|Users)\/[^/]+/)?.[0];
  if (inferred) candidates.add(inferred);
  if (reference.path === "/root" || reference.path.startsWith("/root/")) candidates.add("/root");
  candidates.add("/root");

  for (const base of ["/home", "/Users"]) {
    try {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(reference.with({ path: base }))) {
        if ((type & vscode.FileType.Directory) !== 0) {
          candidates.add(path.posix.join(base, name));
        }
      }
    } catch {
      // Ignore remote directories that are not visible to this workspace provider.
    }
  }

  for (const candidate of candidates) {
    const home = reference.with({ path: candidate });
    try {
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(home, ...credentialSegments));
      return home;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

export async function collectRemoteWindowsCredentialUris(
  reference: vscode.Uri,
  credentialSegments: string[],
): Promise<vscode.Uri[]> {
  const result: vscode.Uri[] = [];
  const base = "/mnt/c/Users";
  try {
    for (const [name, type] of await vscode.workspace.fs.readDirectory(reference.with({ path: base }))) {
      if ((type & vscode.FileType.Directory) !== 0) {
        result.push(reference.with({ path: path.posix.join(base, name, ...credentialSegments) }));
      }
    }
  } catch {
    // The Windows mount may not be available in this remote environment.
  }
  return result;
}

export async function readDefaultWslFile(relativePath: string): Promise<string | undefined> {
  if (process.platform !== "win32") return undefined;
  try {
    const result = await execFileAsync(
      "wsl.exe",
      ["--", "sh", "-lc", `cat "$HOME/${relativePath}"`],
      {
        timeout: 4000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      },
    );
    const output = typeof result.stdout === "string" ? result.stdout.trim() : "";
    return output || undefined;
  } catch {
    return undefined;
  }
}
