import * as path from "node:path";

export const REMOTE_PATH_VARIABLES = [
  "HOME",
  "CODEX_HOME",
  "CLAUDE_CONFIG_DIR",
] as const;

export type RemotePathVariable = typeof REMOTE_PATH_VARIABLES[number];

/**
 * Parse only the remote path variables needed for credential discovery.
 * `/proc/self/environ` can contain tokens and other secrets, so callers must
 * never retain or expose the complete environment.
 */
export function parseRemotePathEnvironment(
  text: string,
): Partial<Record<RemotePathVariable, string>> {
  const result: Partial<Record<RemotePathVariable, string>> = {};
  const allowed = new Set<string>(REMOTE_PATH_VARIABLES);
  const entries = text.includes("\0") ? text.split("\0") : text.split(/\r?\n/);

  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;
    const name = entry.slice(0, separator);
    if (!allowed.has(name)) continue;
    const value = entry.slice(separator + 1).trim();
    if (value) result[name as RemotePathVariable] = value;
  }
  return result;
}

/** Normalize an absolute path so it can be used as a remote URI path. */
export function normalizeRemoteAbsolutePath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalizedSeparators = value.trim().replace(/\\/g, "/");
  if (!normalizedSeparators) return undefined;

  const withLeadingSlash = /^[A-Za-z]:\//.test(normalizedSeparators)
    ? `/${normalizedSeparators}`
    : normalizedSeparators;
  if (!withLeadingSlash.startsWith("/")) return undefined;
  return path.posix.normalize(withLeadingSlash);
}

/**
 * Infer only the current user's home when the open workspace itself is inside
 * a conventional home directory. Deliberately do not scan /home, /Users, or
 * WSL's /mnt/c/Users because that could select another environment or user.
 */
export function inferRemoteHomePath(workspacePath: string): string | undefined {
  const normalized = normalizeRemoteAbsolutePath(workspacePath);
  if (!normalized) return undefined;
  if (normalized === "/root" || normalized.startsWith("/root/")) return "/root";

  const posixMatch = normalized.match(/^\/(home|Users)\/([^/]+)(?:\/|$)/);
  if (posixMatch) return `/${posixMatch[1]}/${posixMatch[2]}`;

  const windowsMatch = normalized.match(/^\/([A-Za-z]:)\/Users\/([^/]+)(?:\/|$)/i);
  if (windowsMatch) return `/${windowsMatch[1]}/Users/${windowsMatch[2]}`;
  return undefined;
}
