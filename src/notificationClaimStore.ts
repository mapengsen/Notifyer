import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const DEFAULT_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLAIM_FILE_PATTERN = /^[a-f0-9]{64}\.claim$/;

/**
 * Coordinates notification delivery across VS Code windows.
 *
 * Each event is represented by an atomically created file in extension global
 * storage. `wx` guarantees that only one extension host can claim an event,
 * even when several VS Code windows discover it at the same time.
 */
export class NotificationClaimStore {
  public constructor(
    private readonly rootPath: string,
    private readonly claimTtlMs = DEFAULT_CLAIM_TTL_MS,
  ) {}

  public claim(key: string): boolean {
    fs.mkdirSync(this.rootPath, { recursive: true });
    const digest = createHash("sha256").update(key).digest("hex");
    const claimPath = path.join(this.rootPath, `${digest}.claim`);

    let descriptor: number | undefined;
    try {
      descriptor = fs.openSync(claimPath, "wx");
      fs.writeFileSync(descriptor, `${Date.now()}\n`, "utf8");
      return true;
    } catch (error) {
      if (isFileExistsError(error)) return false;
      throw error;
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }

  public pruneExpiredClaims(now = Date.now()): void {
    fs.mkdirSync(this.rootPath, { recursive: true });
    const expiresBefore = now - this.claimTtlMs;
    for (const entry of fs.readdirSync(this.rootPath, { withFileTypes: true })) {
      if (!entry.isFile() || !CLAIM_FILE_PATTERN.test(entry.name)) continue;
      const claimPath = path.join(this.rootPath, entry.name);
      try {
        if (fs.statSync(claimPath).mtimeMs < expiresBefore) fs.unlinkSync(claimPath);
      } catch (error) {
        if (!isFileMissingError(error)) throw error;
      }
    }
  }
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}

function isFileMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
