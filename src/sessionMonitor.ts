import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import {
  buildTokenDelta,
  isChildSessionMeta,
  normalizeTimestamp,
  normalizeTokenUsage,
  projectNameFromCwd,
  truncate,
  type TokenUsage,
} from "./core";
import { notifyDesktop } from "./notify";

interface TurnState {
  cwd?: string;
  userMessage?: string;
  lastAgentMessage?: string;
  errorMessage?: string;
  model?: string;
  tokenUsage?: TokenUsage;
}

interface Tracker {
  uri: vscode.Uri;
  offset: number;
  remainder: string;
  lastKnownSize: number;
  lastKnownMtimeMs: number;
  sessionId?: string;
  cwd?: string;
  isChild: boolean;
  activeTurnId?: string;
  latestTokenUsage?: TokenUsage;
  lastCompletedTokenUsage?: TokenUsage;
  turns: Map<string, TurnState>;
}

interface CompletionPayload {
  id: string;
  title: string;
  message: string;
  level: "info" | "error";
  sessionId: string;
  turnId: string;
  projectName: string;
  cwd?: string;
}

export class CodexSessionMonitor implements vscode.Disposable {
  private readonly trackers = new Map<string, Tracker>();
  private readonly processedEventIds = new Set<string>();
  private pollTimer: NodeJS.Timeout | undefined;
  private pollInFlight = false;
  private sessionsRootUri: vscode.Uri | undefined;
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
    this.sessionsRootUri = undefined;
    this.notificationStartMs = Date.now();
    await this.poll(false);
    this.pollTimer = setInterval(() => void this.poll(true), this.getPollMs());
  }

  public getDiagnostics(): Record<string, unknown> {
    return {
      running: Boolean(this.pollTimer),
      sessionsRoot: this.sessionsRootUri?.toString() ?? "",
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
      this.sessionsRootUri ??= await resolveSessionsRootUri();
      if (!this.sessionsRootUri) return;
      const files = await collectRecentSessionFiles(this.sessionsRootUri, this.getLookbackDays());
      for (const file of files) await this.refreshFile(file, emitNotifications);
      this.lastError = "";
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.error("[codex-task-companion] failed to poll Codex sessions", error);
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
        isChild: false,
        turns: new Map(),
      };
      this.trackers.set(key, tracker);
      await this.processWholeFile(tracker, false);
      return;
    }

    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size === tracker.lastKnownSize && stat.mtime <= tracker.lastKnownMtimeMs) return;
    await this.processWholeFile(tracker, emitNotifications);
  }

  private async processWholeFile(tracker: Tracker, emitNotifications: boolean): Promise<void> {
    const stat = await vscode.workspace.fs.stat(tracker.uri);
    const bytes = await vscode.workspace.fs.readFile(tracker.uri);
    const text = Buffer.from(bytes).toString("utf8");
    if (text.length < tracker.offset) {
      tracker.offset = 0;
      tracker.remainder = "";
      tracker.turns.clear();
      tracker.activeTurnId = undefined;
      tracker.latestTokenUsage = undefined;
      tracker.lastCompletedTokenUsage = undefined;
    }

    const combined = `${tracker.remainder}${text.slice(tracker.offset)}`;
    tracker.offset = text.length;
    tracker.lastKnownSize = stat.size;
    tracker.lastKnownMtimeMs = stat.mtime;
    if (!combined) return;

    const lines = combined.split(/\r?\n/);
    tracker.remainder = combined.endsWith("\n") ? "" : (lines.pop() ?? "");
    for (const line of lines) await this.processLine(tracker, line, emitNotifications);
  }

  private async processLine(tracker: Tracker, line: string, emitNotifications: boolean): Promise<void> {
    if (!line.trim()) return;
    let record: Record<string, unknown>;
    try {
      record = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }

    if (record.type === "session_meta") {
      const meta = asRecord(record.payload);
      tracker.sessionId = stringValue(meta.session_id) ?? stringValue(meta.id);
      tracker.cwd = stringValue(meta.cwd) ?? tracker.cwd;
      tracker.isChild = isChildSessionMeta(meta);
      return;
    }

    if (record.type === "turn_context") {
      const payload = asRecord(record.payload);
      const turnId = stringValue(payload.turn_id);
      if (!turnId) return;
      tracker.activeTurnId = turnId;
      const turn = this.getTurn(tracker, turnId);
      turn.cwd = stringValue(payload.cwd) ?? turn.cwd;
      turn.model = stringValue(payload.model) ?? turn.model;
      return;
    }

    if (record.type !== "event_msg") return;
    const payload = asRecord(record.payload);
    const payloadType = stringValue(payload.type);
    if (!payloadType) return;
    const turnId = stringValue(payload.turn_id) ?? tracker.activeTurnId;
    const turn = turnId ? this.getTurn(tracker, turnId) : undefined;

    if (payloadType === "task_started" && turnId) {
      tracker.activeTurnId = turnId;
      return;
    }
    if (payloadType === "user_message" && turn) {
      turn.userMessage = stringValue(payload.message) ?? turn.userMessage;
      return;
    }
    if (payloadType === "agent_message" && turn) {
      turn.lastAgentMessage = stringValue(payload.message) ?? turn.lastAgentMessage;
      return;
    }
    if (payloadType === "error" && turn) {
      turn.errorMessage = stringValue(payload.message) ?? turn.errorMessage;
      return;
    }
    if (payloadType === "token_count") {
      const usage = normalizeTokenUsage(asRecord(payload.info).total_token_usage);
      if (usage) {
        tracker.latestTokenUsage = usage;
        if (turn) turn.tokenUsage = usage;
      }
      return;
    }
    if (payloadType !== "task_complete" || !turnId || tracker.isChild) return;

    const sessionId = tracker.sessionId ?? inferSessionId(tracker.uri);
    const eventId = `${sessionId}:${turnId}`;
    if (this.processedEventIds.has(eventId)) return;
    this.processedEventIds.add(eventId);

    const cwd = turn?.cwd ?? tracker.cwd;
    if (!matchesCurrentWorkspace(cwd)) return;

    const completedAt = normalizeTimestamp(payload.completed_at) ?? normalizeTimestamp(record.timestamp);
    const shouldNotify = emitNotifications || this.shouldNotifyInitialScan(completedAt);
    if (!shouldNotify) return;

    const level = turn?.errorMessage ? "error" : "info";
    const projectName = projectNameFromCwd(cwd);
    const title = level === "error" ? `Codex 主任务失败 · ${projectName}` : `Codex 主任务已完成 · ${projectName}`;
    const detail = truncate(turn?.lastAgentMessage ?? turn?.errorMessage ?? turn?.userMessage ?? "任务已完成");
    const message = detail || "任务已完成";
    const completion: CompletionPayload = {
      id: eventId,
      title,
      message,
      level,
      sessionId,
      turnId,
      projectName,
      cwd,
    };
    this.notificationCount += 1;
    void notifyDesktop(completion.title, completion.message, completion.level, "codex", { hideTitle: true });
  }

  private getTurn(tracker: Tracker, turnId: string): TurnState {
    const existing = tracker.turns.get(turnId);
    if (existing) return existing;
    const created: TurnState = {};
    tracker.turns.set(turnId, created);
    return created;
  }

  private shouldNotifyInitialScan(completedAt: string | undefined): boolean {
    const enabled = vscode.workspace.getConfiguration("codexTaskCompanion.codex").get<boolean>("notifyInitialScan", false);
    if (enabled) return true;
    const timestamp = completedAt ? Date.parse(completedAt) : NaN;
    return Number.isFinite(timestamp) && timestamp >= this.notificationStartMs;
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration("codexTaskCompanion.codex").get<boolean>("enabled", true);
  }

  private getPollMs(): number {
    return Math.max(500, vscode.workspace.getConfiguration("codexTaskCompanion.codex").get<number>("sessionPollMs", 1500));
  }

  private getLookbackDays(): number {
    return Math.max(1, Math.min(14, Math.floor(vscode.workspace.getConfiguration("codexTaskCompanion.codex").get<number>("sessionLookbackDays", 7))));
  }
}

async function resolveSessionsRootUri(): Promise<vscode.Uri | undefined> {
  const config = vscode.workspace.getConfiguration("codexTaskCompanion.codex");
  const configured = config.get<string>("sessionsRoot", "").trim();
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (configured) return resolveConfiguredRoot(configured, folder?.uri);

  if (folder?.uri.scheme !== "file" && folder?.uri) {
    const remoteHome = await findRemoteHome(folder.uri);
    return remoteHome ? vscode.Uri.joinPath(remoteHome, ".codex", "sessions") : undefined;
  }

  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
  return vscode.Uri.file(path.join(codexHome, "sessions"));
}

async function resolveConfiguredRoot(value: string, reference?: vscode.Uri): Promise<vscode.Uri> {
  if (reference?.scheme !== "file" && reference) {
    if (value.startsWith("~")) {
      const home = await findRemoteHome(reference);
      return home ? vscode.Uri.joinPath(home, ...splitSegments(value.slice(1))) : reference;
    }
    if (value.startsWith("/")) return reference.with({ path: value.replace(/\\/g, "/") });
    return vscode.Uri.joinPath(reference, ...splitSegments(value));
  }
  const base = process.env.CODEX_HOME || os.homedir();
  if (value.startsWith("~")) return vscode.Uri.file(path.join(os.homedir(), value.slice(1)));
  if (path.isAbsolute(value)) return vscode.Uri.file(value);
  return vscode.Uri.file(path.join(reference?.fsPath ?? base, value));
}

async function findRemoteHome(reference: vscode.Uri): Promise<vscode.Uri | undefined> {
  const candidates = new Set<string>();
  const inferred = reference.path.match(/^\/(home|Users)\/[^/]+/)?.[0];
  if (inferred) candidates.add(inferred);
  if (reference.path === "/root" || reference.path.startsWith("/root/")) candidates.add("/root");
  candidates.add("/root");
  for (const base of ["/home", "/Users"]) {
    try {
      for (const [name, type] of await vscode.workspace.fs.readDirectory(reference.with({ path: base }))) {
        if ((type & vscode.FileType.Directory) !== 0) candidates.add(path.posix.join(base, name));
      }
    } catch {
      // Ignore directories that are not visible in this remote provider.
    }
  }
  for (const candidate of candidates) {
    const home = reference.with({ path: candidate });
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.joinPath(home, ".codex", "sessions"));
      if ((stat.type & vscode.FileType.Directory) !== 0) return home;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

async function collectRecentSessionFiles(root: vscode.Uri, lookbackDays: number): Promise<vscode.Uri[]> {
  const files: vscode.Uri[] = [];
  for (let offset = 0; offset < lookbackDays; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const folder = vscode.Uri.joinPath(root, String(date.getFullYear()), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0"));
    await collectJsonlFiles(folder, files);
  }
  return files;
}

async function collectJsonlFiles(folder: vscode.Uri, files: vscode.Uri[]): Promise<void> {
  let entries: readonly [string, vscode.FileType][];
  try {
    entries = await vscode.workspace.fs.readDirectory(folder);
  } catch {
    return;
  }
  for (const [name, type] of entries) {
    const uri = vscode.Uri.joinPath(folder, name);
    if ((type & vscode.FileType.Directory) !== 0) {
      await collectJsonlFiles(uri, files);
    } else if ((type & vscode.FileType.File) !== 0 && name.toLowerCase().endsWith(".jsonl")) {
      files.push(uri);
    }
  }
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

function splitSegments(value: string): string[] {
  return value.split(/[\\/]+/).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
