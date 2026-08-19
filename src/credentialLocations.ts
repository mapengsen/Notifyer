import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  inferRemoteHomePath,
  normalizeRemoteAbsolutePath,
  parseRemotePathEnvironment,
  type RemotePathVariable,
} from "./credentialPathCore";

export interface RemoteCredentialLocation {
  configDirectoryVariable: Exclude<RemotePathVariable, "HOME">;
  defaultDirectoryName: string;
  fileName: string;
}

export function isRemoteWindow(): boolean {
  return Boolean(vscode.env.remoteName);
}

/** Return a URI whose scheme and authority belong to this VS Code remote. */
export function getRemoteWorkspaceReference(): vscode.Uri | undefined {
  const folder = vscode.workspace.workspaceFolders?.find(({ uri }) => isRemoteResource(uri));
  if (folder) return folder.uri;

  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile && isRemoteResource(workspaceFile)) return workspaceFile;

  const activeDocument = vscode.window.activeTextEditor?.document.uri;
  if (activeDocument && isRemoteResource(activeDocument)) return activeDocument;
  return undefined;
}

/**
 * Resolve one credential file in the current remote environment only.
 * Environment overrides take precedence over the conventional home path.
 */
export async function resolveRemoteCredentialUri(
  reference: vscode.Uri,
  location: RemoteCredentialLocation,
): Promise<vscode.Uri | undefined> {
  const remoteEnvironment = await readRemotePathEnvironment(reference);
  const homePath = normalizeRemoteAbsolutePath(remoteEnvironment.HOME) ??
    inferRemoteHomePath(reference.path);
  const configuredDirectoryValue = remoteEnvironment[location.configDirectoryVariable];

  if (configuredDirectoryValue) {
    const configuredDirectory = resolveRemotePathValue(configuredDirectoryValue, homePath);
    if (!configuredDirectory) return undefined;
    const configuredUri = reference.with({
      path: path.posix.join(configuredDirectory, location.fileName),
      query: "",
      fragment: "",
    });
    return await fileExists(configuredUri) ? configuredUri : undefined;
  }

  if (!homePath) return undefined;
  const defaultUri = reference.with({
    path: path.posix.join(homePath, location.defaultDirectoryName, location.fileName),
    query: "",
    fragment: "",
  });
  return await fileExists(defaultUri) ? defaultUri : undefined;
}

/** Resolve a user-configured credential path inside the current environment. */
export async function resolveConfiguredCredentialUri(
  value: string,
  remoteReference?: vscode.Uri,
): Promise<vscode.Uri | undefined> {
  const configured = value.trim();
  if (!configured) return undefined;

  if (remoteReference) {
    const remoteEnvironment = await readRemotePathEnvironment(remoteReference);
    const homePath = normalizeRemoteAbsolutePath(remoteEnvironment.HOME) ??
      inferRemoteHomePath(remoteReference.path);
    const normalized = configured.replace(/\\/g, "/");

    let remotePath: string | undefined;
    if (normalized === "~" || normalized.startsWith("~/")) {
      remotePath = homePath
        ? path.posix.join(homePath, normalized === "~" ? "" : normalized.slice(2))
        : undefined;
    } else {
      remotePath = normalizeRemoteAbsolutePath(normalized);
      if (!remotePath) remotePath = path.posix.join(remoteReference.path, normalized);
    }
    return remotePath
      ? remoteReference.with({ path: remotePath, query: "", fragment: "" })
      : undefined;
  }

  if (configured === "~" || configured.startsWith("~/") || configured.startsWith("~\\")) {
    const suffix = configured === "~" ? "" : configured.slice(2);
    return vscode.Uri.file(path.join(os.homedir(), suffix));
  }
  if (path.isAbsolute(configured) || /^[A-Za-z]:[\\/]/.test(configured)) {
    return vscode.Uri.file(configured);
  }
  return vscode.Uri.file(path.join(os.homedir(), configured));
}

async function readRemotePathEnvironment(
  reference: vscode.Uri,
): Promise<Partial<Record<RemotePathVariable, string>>> {
  try {
    const processEnvironmentUri = reference.with({
      path: "/proc/self/environ",
      query: "",
      fragment: "",
    });
    const bytes = await vscode.workspace.fs.readFile(processEnvironmentUri);
    return parseRemotePathEnvironment(Buffer.from(bytes).toString("utf8"));
  } catch {
    // Non-Linux remotes may not expose /proc. Home inference remains available
    // when the workspace itself is inside that user's conventional home path.
    return {};
  }
}

function resolveRemotePathValue(value: string, homePath: string | undefined): string | undefined {
  const normalized = value.trim().replace(/\\/g, "/");
  if (normalized === "~" || normalized.startsWith("~/")) {
    return homePath
      ? path.posix.join(homePath, normalized === "~" ? "" : normalized.slice(2))
      : undefined;
  }
  const absolute = normalizeRemoteAbsolutePath(normalized);
  if (absolute) return absolute;
  return homePath ? path.posix.join(homePath, normalized) : undefined;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return (stat.type & vscode.FileType.File) !== 0;
  } catch {
    return false;
  }
}

function isRemoteResource(uri: vscode.Uri): boolean {
  return uri.scheme !== "file" && uri.scheme !== "untitled";
}
