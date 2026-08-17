import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { isClaudeMainTaskCompletion, projectNameFromCwd, truncate } from "./core";
import { notifyDesktop } from "./notify";

interface ClaudeTracker {
  uri: vscode.Uri;
  offset: number;
  remainder: string;
  lastKnownSize: number;
  lastKnownMtimeMs: number;
  sessionId?: string;
  cwd?: string;
  isSidechain: boolean;
}

export class ClaudeSessionMonitor implements vscode.Disposable {
  private readonly trackers = new Map<string, ClaudeTracker>();
  private readonly processedEventIds = new Set<string>();
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private projectsRootUri: vscode.Uri | undefined;
  private notificationStartMs = Date.now();
  private lastError = "";
  private pollCount = 0;
  private notificationCount = 0;

  public async start(): Promise<void> {
    await this.restart();
  }

  public async restart(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.trackers.clear();
    this.processedEventIds.clear();
    this.projectsRootUri = undefined;
    this.notificationStartMs = Date.now();
    await this.poll(false);
    this.pollTimer = setInterval(() => void this.poll(true), this.getPollMs());
  }

  public getDiagnostics(): Record<string, unknown> {
    return {
      running: Boolean(this.pollTimer),
      projectsRoot: this.projectsRootUri?.toString() ?? "",
      trackedFileCount: this.trackers.size,
      processedEventCount: this.processedEventIds.size,
      pollCount: this.pollCount,
      notificationCount: this.notificationCount,
      lastError: this.lastError,
    };
  }

  public dispose(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
  }

  private async poll(emitNotifications: boolean): Promise<void> {
    if (this.pollInFlight || !this.isEnabled()) return;
    this.pollInFlight = true;
    this.pollCount += 1;
    try {
      this.projectsRootUri ??= await resolveClaudeProjectsRootUri();
      if (!this.projectsRootUri) return;
      const files = await collectRecentJsonlFiles(this.projectsRootUri, this.getLookbackDays());
      for (const file of files) await this.refreshFile(file, emitNotifications);
      this.lastError = "";
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[codex-task-companion] failed to poll Claude sessions", error);
    } finally {
      this.pollInFlight = false;
    }
  }

  private async refreshFile(uri: vscode.Uri, emitNotifications: boolean): Promise<void> {
    const key = uri.toString();
    let tracker = this.trackers.get(key);
    if (!tracker) {
      tracker = {
        uri,
        offset: 0,
        remainder: "",
        lastKnownSize: 0,
        lastKnownMtimeMs: 0,
        isSidechain: false,
      };
      this.trackers.set(key, tracker);
      await this.processWholeFile(tracker, emitNotifications);
      return;
    }

    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size === tracker.lastKnownSize && stat.mtime <= tracker.lastKnownMtimeMs) return;
    await this.processWholeFile(tracker, emitNotifications);
  }

  private async processWholeFile(tracker: ClaudeTracker, emitNotifications: boolean): Promise<void> {
    const stat = await vscode.workspace.fs.stat(tracker.uri);
    const bytes = await vscode.workspace.fs.readFile(tracker.uri);
    const text = Buffer.from(bytes).toString("utf8");
    if (text.length < tracker.offset) {
      tracker.offset = 0;
      tracker.remainder = "";
      tracker.sessionId = undefined;
      tracker.cwd = undefined;
      tracker.isSidechain = false;
    }

    const combined = `${tracker.remainder}${text.slice(tracker.offset)}`;
    tracker.offset = text.length;
    tracker.lastKnownSize = stat.size;
    tracker.lastKnownMtimeMs = stat.mtime;
    if (!combined) return;

    const lines = combined.split(/\r?\n/);
    tracker.remainder = combined.endsWith("\n") ? "" : (lines.pop() ?? "");
    for (const line of lines) this.processLine(tracker, line, emitNotifications);
  }

  private processLine(tracker: ClaudeTracker, line: string, emitNotifications: boolean): void {
    if (!line.trim()) return;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    tracker.sessionId = stringValue(record.sessionId) ?? tracker.sessionId;
    tracker.cwd = stringValue(record.cwd) ?? tracker.cwd;
    if (record.isSidechain === true || stringValue(record.agent_id) || stringValue(record.agentId)) {
      tracker.isSidechain = true;
    }
    if (!isClaudeMainTaskCompletion(record) || tracker.isSidechain) return;

    const sessionId = tracker.sessionId ?? inferSessionId(tracker.uri);
    const eventId = `${sessionId}:${stringValue(record.uuid) ?? String(record.timestamp ?? tracker.offset)}`;
    if (this.processedEventIds.has(eventId)) return;
    this.processedEventIds.add(eventId);

    const cwd = tracker.cwd;
    if (!matchesCurrentWorkspace(cwd)) return;

    const completedAt = parseTimestamp(record.timestamp);
    const shouldNotify = emitNotifications || this.shouldNotifyInitialScan(completedAt);
    if (!shouldNotify) return;

    const projectName = projectNameFromCwd(cwd);
    const detail = summarizeClaudeAssistant(record);
    const title = `Claude 主任务已完成 · ${projectName}`;
    const message = detail || "任务已完成";
    this.notificationCount += 1;
    void notifyDesktop(title, message, "info", "claude", { hideTitle: true });
  }

  private shouldNotifyInitialScan(completedAt: number | undefined): boolean {
    const enabled = vscode.workspace
      .getConfiguration("codexTaskCompanion.claude")
      .get<boolean>("notifyInitialScan", false);
    return enabled || (completedAt !== undefined && completedAt >= this.notificationStartMs);
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexTaskCompanion.claude").get<boolean>("enabled", true);
  }

  private getPollMs(): number {
    return Math.max(500, vscode.workspace.getConfiguration("codexTaskCompanion.claude").get<number>("sessionPollMs", 1500));
  }

  private getLookbackDays(): number {
    return Math.max(1, Math.min(30, Math.floor(vscode.workspace.getConfiguration("codexTaskCompanion.claude").get<number>("sessionLookbackDays", 7))));
  }
}

async function resolveClaudeProjectsRootUri(): Promise<vscode.Uri | undefined> {
  const config = vscode.workspace.getConfiguration("codexTaskCompanion.claude");
  const configured = config.get<string>("projectsRoot", "").trim();
  if (configured) return resolveConfiguredRoot(configured);

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder?.uri.scheme !== "file" && folder?.uri) {
    const home = await findRemoteHome(folder.uri);
    return home ? vscode.Uri.joinPath(home, ".claude", "projects") : undefined;
  }

  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude");
  return vscode.Uri.file(path.join(configDir, "projects"));
}

async function resolveConfiguredRoot(value: string): Promise<vscode.Uri> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder?.uri.scheme !== "file" && folder?.uri) {
    if (value.startsWith("~")) {
      const home = await findRemoteHome(folder.uri);
      return home ? vscode.Uri.joinPath(home, ...splitSegments(value.slice(1))) : folder.uri;
    }
    if (value.startsWith("/")) return folder.uri.with({ path: value.replace(/\\/g, "/") });
    return vscode.Uri.joinPath(folder.uri, ...splitSegments(value));
  }

  if (isWindowsAbsolute(value) || path.isAbsolute(value)) return vscode.Uri.file(value);
  return vscode.Uri.file(path.join(os.homedir(), value));
}

async function findRemoteHome(reference: vscode.Uri): Promise<vscode.Uri | undefined> {
  const candidates = new Set<string>();
  const inferred = reference.path.match(/^\/(home|Users)\/[^/]+/)?.[0];
  if (inferred) candidates.add(inferred);
  candidates.add("/root");
  for (const base of ["/home", "/Users"]) {
    try {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(reference.with({ path: base }))) {
        if ((type & vscode.FileType.Directory) !== 0) candidates.add(path.posix.join(base, name));
      }
    } catch {
      // Ignore remote directories that are not visible to this workspace provider.
    }
  }
  for (const candidate of candidates) {
    const home = reference.with({ path: candidate });
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(home, ".claude", "projects"));
      if ((stat.type & vscode.FileType.Directory) !== 0) return home;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

async function collectRecentJsonlFiles(root: vscode.Uri, lookbackDays: number): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  const cutoff = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
  await collectJsonlFiles(root, files, cutoff);
  return files;
}

async function collectJsonlFiles(folder: vscode.Uri, files: vscode.Uri[], cutoff: number): Promise<void> {
  let entries: readonly [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    return;
  }
  for (const [name, type] of entries) {
    const uri = vscode.Uri.joinPath(folder, name);
    if ((type & vscode.FileType.Directory) !== 0) {
      await collectJsonlFiles(uri, files, cutoff);
    } else if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".jsonl")) {
      try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.mtime >= cutoff) files.push(uri);
      } catch {
        // The session may be rotated while it is being scanned.
      }
    }
  }
}

function summarizeClaudeAssistant(record: Record<string, unknown>): string {
  const message = asRecord(record.message);
  const content = message.content;
  if (typeof content === "string") return truncate(content);
  if (!Array.isArray(content)) return "任务已完成";
  const text = content
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => stringValue(item.text))
    .filter((value): value is string => Boolean(value))
    .join(" ");
  return truncate(text || "任务已完成");
}

function matchesCurrentWorkspace(cwd: string | undefined): boolean {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (!folders.length || !cwd) return true;
  const candidate = normalizePath(cwd);
  return folders.some((folder) => {
    const root = normalizePath(folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path);
    return root === candidate || candidate.startsWith(`${root}/`) || root.startsWith(`${candidate}/`);
  });
}

function normalizePath(value: string): string {
  let normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
  if (/^[A-Za-z]:/.test(normalized)) normalized = normalized.toLowerCase();
  return normalized || "/";
}

function inferSessionId(uri: vscode.Uri): string {
  const match = uri.path.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.jsonl)?$/i);
  return match?.[1] ?? path.basename(uri.path, path.extname(uri.path));
}

function parseTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function isWindowsAbsolute(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value);
}

function splitSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}
