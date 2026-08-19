import axios, { AxiosProxyConfig } from "axios";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  clampPercent,
  DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS,
  formatQuotaStatus,
  formatResetTime,
  remainingPercent,
  UsageRefreshCadence,
} from "./core";
import {
  getRemoteWorkspaceReference,
  isRemoteWindow,
  resolveConfiguredCredentialUri,
  resolveRemoteCredentialUri,
} from "./credentialLocations";
import type { UsageDisplayMode } from "./usage";

interface ClaudeAuthData {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

export interface ClaudeUsageWindow {
  usedPercent: number;
  remainingPercent: number;
  resetsAt?: string;
  resetsInSeconds?: number;
}

class ClaudeAuthenticationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "ClaudeAuthenticationError";
  }
}

export interface ClaudeUsageSnapshot {
  fiveHour?: ClaudeUsageWindow;
  sevenDay?: ClaudeUsageWindow;
  sevenDayOpus?: ClaudeUsageWindow;
  sevenDaySonnet?: ClaudeUsageWindow;
  subscriptionType?: string;
  updatedAt: Date;
}

interface RawClaudeUsageWindow {
  utilization?: unknown;
  used_percent?: unknown;
  used_percentage?: unknown;
  resets_at?: unknown;
}

export class ClaudeUsageMonitor implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private snapshot: ClaudeUsageSnapshot | undefined;
  private lastError = "";
  private displayMode: UsageDisplayMode = getClaudeUsageDisplayMode();
  private readonly refreshCadence = new UsageRefreshCadence();

  public constructor() {
    this.statusBar = vscode.window.createStatusBarItem(
      "claudeUsage",
      vscode.StatusBarAlignment.Right,
      86,
    );
    this.statusBar.name = "Notifyer: Claude quota";
    this.statusBar.command = "codexTaskCompanion.refreshClaudeUsage";
    this.statusBar.text = "$(sparkle) Claude --";
    this.statusBar.tooltip = "Claude usage is loading…";
  }

  public start(): void {
    void this.refresh().finally(() => this.scheduleNext());
  }

  public async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const auths = await loadClaudeAuthDataCandidates();
      if (!auths.length) {
        this.snapshot = undefined;
        this.lastError = "Claude OAuth credentials were not found in the current VS Code environment.";
        this.renderAuthRequired();
        return;
      }

      let lastUsageError = "";
      for (const auth of auths) {
        if (auth.expiresAt !== undefined && auth.expiresAt <= Date.now()) {
          lastUsageError = "Claude OAuth credentials have expired.";
          continue;
        }
        try {
          const usage = await fetchClaudeUsage(auth, getClaudeProxyUrl());
          if (!usage.fiveHour && !usage.sevenDay && !usage.sevenDayOpus && !usage.sevenDaySonnet) {
            lastUsageError = "Claude usage endpoint returned no recognized rate-limit windows.";
            continue;
          }

          this.snapshot = {
            ...usage,
            subscriptionType: auth.subscriptionType,
            updatedAt: new Date(),
          };
          this.lastError = "";
          this.renderSnapshot(this.snapshot);
          return;
        } catch (error) {
          if (error instanceof ClaudeAuthenticationError) {
            lastUsageError = error.message;
            continue;
          }
          lastUsageError = error instanceof Error ? error.message : String(error);
        }
      }

      this.snapshot = undefined;
      this.lastError = lastUsageError || "Claude OAuth credentials are invalid or expired.";
      if (lastUsageError && !lastUsageError.toLowerCase().includes("expired") &&
          !lastUsageError.toLowerCase().includes("invalid")) {
        this.renderError();
      } else {
        this.renderAuthRequired();
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.snapshot = undefined;
      this.renderError();
    } finally {
      this.inFlight = false;
    }
  }

  public async chooseDisplayMode(): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      {
        label: "Remaining",
        description: "Show the Claude percentage that is still available (default)",
        value: "remaining" as const,
      },
      {
        label: "Used",
        description: "Show the Claude percentage that has already been used",
        value: "used" as const,
      },
    ], {
      placeHolder: "Choose the Claude quota display",
    });
    if (!selected) return;

    await vscode.workspace
      .getConfiguration("codexTaskCompanion.claude")
      .update("usageDisplayMode", selected.value, vscode.ConfigurationTarget.Global);
  }

  public reloadConfiguration(): void {
    this.displayMode = getClaudeUsageDisplayMode();
    if (this.snapshot) {
      this.renderSnapshot(this.snapshot);
    }
    this.scheduleNext();
  }

  public getDiagnostics(): Record<string, unknown> {
    return {
      hasSnapshot: Boolean(this.snapshot),
      lastError: this.lastError,
      displayMode: this.displayMode,
      startupRefreshesRemaining: this.refreshCadence.startupRefreshesRemaining,
      updatedAt: this.snapshot?.updatedAt.toISOString() ?? "",
      fiveHourRemainingPercent: this.snapshot?.fiveHour?.remainingPercent,
      sevenDayRemainingPercent: this.snapshot?.sevenDay?.remainingPercent,
    };
  }

  public dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.statusBar.dispose();
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    const regularIntervalSeconds = vscode.workspace
      .getConfiguration("codexTaskCompanion.claude")
      .get<number>("usageUpdateIntervalSeconds", DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS);
    const seconds = this.refreshCadence.getDelaySeconds(regularIntervalSeconds);
    this.timer = setTimeout(() => {
      this.refreshCadence.consumeScheduledRefresh();
      void this.refresh().finally(() => this.scheduleNext());
    }, seconds * 1000);
  }

  private renderSnapshot(snapshot: ClaudeUsageSnapshot): void {
    const primary = snapshot.fiveHour ?? snapshot.sevenDay ?? snapshot.sevenDayOpus ?? snapshot.sevenDaySonnet;
    const displayPercent = primary ? getDisplayPercent(primary, this.displayMode) : undefined;
    const presentation = primary && displayPercent !== undefined
      ? formatQuotaStatus(displayPercent, this.displayMode, primary.resetsInSeconds, snapshot.updatedAt)
      : undefined;
    this.statusBar.text = presentation
      ? `$(sparkle) ${presentation.statusText}`
      : "$(sparkle) Claude --";
    this.statusBar.show();
    this.statusBar.color = undefined;
    this.statusBar.backgroundColor = undefined;
    this.statusBar.tooltip = buildClaudeUsageTooltip(snapshot, this.displayMode);
  }

  private renderAuthRequired(): void {
    this.statusBar.text = "$(sparkle) Claude --";
    this.statusBar.hide();
    this.statusBar.color = new vscode.ThemeColor("editorWarning.foreground");
    this.statusBar.tooltip = "Claude OAuth credentials were not found or usable in the current VS Code environment. Run claude /login there, then click refresh.";
  }

  private renderError(): void {
    this.statusBar.text = "$(sparkle) Claude ?";
    this.statusBar.show();
    this.statusBar.color = new vscode.ThemeColor("editorWarning.foreground");
    this.statusBar.tooltip = `Unable to read Claude usage. Click to retry.\n\n${this.lastError}`;
  }
}

export function parseClaudeUsageResponse(data: unknown, nowMs = Date.now()): Pick<
  ClaudeUsageSnapshot,
  "fiveHour" | "sevenDay" | "sevenDayOpus" | "sevenDaySonnet"
> {
  const root = asRecord(data);
  return {
    fiveHour: parseClaudeWindow(root.five_hour, nowMs),
    sevenDay: parseClaudeWindow(root.seven_day, nowMs),
    sevenDayOpus: parseClaudeWindow(root.seven_day_opus, nowMs),
    sevenDaySonnet: parseClaudeWindow(root.seven_day_sonnet, nowMs),
  };
}

async function loadClaudeAuthDataCandidates(): Promise<ClaudeAuthData[]> {
  const auths: ClaudeAuthData[] = [];
  const seenTokens = new Set<string>();
  for (const uri of await resolveClaudeCredentialsUris()) {
    const auth = await loadClaudeAuthDataFromUri(uri);
    if (auth && !seenTokens.has(auth.accessToken)) {
      seenTokens.add(auth.accessToken);
      auths.push(auth);
    }
  }

  return auths;
}

async function loadClaudeAuthDataFromUri(uri: vscode.Uri): Promise<ClaudeAuthData | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseClaudeAuthData(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
}

function parseClaudeAuthData(text: string): ClaudeAuthData | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const oauth = asRecord(parsed.claudeAiOauth);
    const accessToken = stringValue(oauth.accessToken);
    if (!accessToken) return undefined;
    return {
      accessToken,
      expiresAt: finiteNumber(oauth.expiresAt),
      subscriptionType: stringValue(oauth.subscriptionType),
    };
  } catch {
    return undefined;
  }
}

async function fetchClaudeUsage(
  auth: ClaudeAuthData,
  proxyUrl: string,
): Promise<Pick<ClaudeUsageSnapshot, "fiveHour" | "sevenDay" | "sevenDayOpus" | "sevenDaySonnet">> {
  const response = await axios.get("https://api.anthropic.com/api/oauth/usage", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": "Notifyer/0.2.11",
    },
    proxy: parseProxy(proxyUrl),
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) {
      throw new ClaudeAuthenticationError("Claude OAuth credentials are invalid or expired.");
    }
    throw new Error(`Claude usage request failed (HTTP ${response.status})`);
  }
  return parseClaudeUsageResponse(response.data);
}

function parseClaudeWindow(raw: unknown, nowMs: number): ClaudeUsageWindow | undefined {
  const value = asRecord(raw) as RawClaudeUsageWindow;
  const rawUtilization = value.utilization ?? value.used_percent ?? value.used_percentage;
  const utilization = finiteNumber(rawUtilization);
  if (utilization === undefined) return undefined;

  const usedPercent = clampPercent(utilization >= 0 && utilization <= 1 ? utilization * 100 : utilization);
  const resetMs = parseResetTimestamp(value.resets_at);
  return {
    usedPercent,
    remainingPercent: remainingPercent(usedPercent),
    resetsAt: resetMs === undefined ? undefined : new Date(resetMs).toISOString(),
    resetsInSeconds: resetMs === undefined ? undefined : Math.max(0, Math.round((resetMs - nowMs) / 1000)),
  };
}

function buildClaudeUsageTooltip(snapshot: ClaudeUsageSnapshot, displayMode: UsageDisplayMode): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = true;
  const displayLabel = displayMode === "remaining" ? "剩余" : "已使用";
  tooltip.appendMarkdown(`**Claude ${displayLabel}额度**\n\n`);
  const primary = snapshot.fiveHour ?? snapshot.sevenDay ?? snapshot.sevenDayOpus ?? snapshot.sevenDaySonnet;
  const primaryLabel = snapshot.fiveHour
    ? "5 小时窗口"
    : snapshot.sevenDay
      ? "7 天窗口"
      : snapshot.sevenDayOpus
        ? "7 天 Opus 窗口"
        : "7 天 Sonnet 窗口";
  if (primary) {
    appendClaudeStatusBarMeaning(tooltip, primaryLabel, primary, displayMode, snapshot.updatedAt);
  }
  if (snapshot.subscriptionType) {
    tooltip.appendMarkdown(`套餐：${escapeMarkdown(snapshot.subscriptionType)}\n\n`);
  }
  tooltip.appendMarkdown("> 额度信息来自当前环境中的 Claude Code OAuth 会话及 Anthropic 额度接口。\n\n");
  appendClaudeWindow(tooltip, "5 小时窗口", snapshot.fiveHour, displayMode);
  appendClaudeWindow(tooltip, "7 天窗口", snapshot.sevenDay, displayMode);
  appendClaudeWindow(tooltip, "7 天 Opus", snapshot.sevenDayOpus, displayMode);
  appendClaudeWindow(tooltip, "7 天 Sonnet", snapshot.sevenDaySonnet, displayMode);
  tooltip.appendMarkdown(`\n最后更新：${snapshot.updatedAt.toLocaleTimeString()}\n\n`);
  tooltip.appendMarkdown("[立即刷新](command:codexTaskCompanion.refreshClaudeUsage) · [切换显示](command:codexTaskCompanion.chooseClaudeUsageDisplayMode) · [打开设置](command:codexTaskCompanion.openSettings)");
  return tooltip;
}

function appendClaudeStatusBarMeaning(
  tooltip: vscode.MarkdownString,
  windowLabel: string,
  window: ClaudeUsageWindow,
  displayMode: UsageDisplayMode,
  updatedAt: Date,
): void {
  const presentation = formatQuotaStatus(
    getDisplayPercent(window, displayMode),
    displayMode,
    window.resetsInSeconds,
    updatedAt,
  );
  if (!presentation) return;

  const percentageMeaning = displayMode === "remaining"
    ? `当前${windowLabel}还剩 ${presentation.percentageText} 可用额度`
    : `当前${windowLabel}已经使用 ${presentation.percentageText} 额度`;
  const resetMeaning = presentation.resetDateTime
    ? `当前${windowLabel}的重置时间，按本地时区显示`
    : `额度接口暂未提供当前${windowLabel}的重置时间`;

  tooltip.appendMarkdown("**状态栏含义**\n\n");
  tooltip.appendMarkdown(`\`${presentation.statusText}\`\n\n`);
  tooltip.appendMarkdown(`- \`${presentation.percentageText} ${presentation.modeLabel}\`：${percentageMeaning}。\n\n`);
  tooltip.appendMarkdown(`- \`${presentation.resetDateTime ?? "--"}\`：${resetMeaning}。\n\n`);
  tooltip.appendMarkdown("> Claude 状态栏优先展示 5 小时窗口；不可用时依次展示 7 天、Opus 和 Sonnet 窗口。\n\n");
}

function appendClaudeWindow(
  tooltip: vscode.MarkdownString,
  label: string,
  window: ClaudeUsageWindow | undefined,
  displayMode: UsageDisplayMode,
): void {
  if (!window) return;
  const displayLabel = displayMode === "remaining" ? "剩余" : "已使用";
  const otherLabel = displayMode === "remaining" ? "已使用" : "剩余";
  const displayPercent = getDisplayPercent(window, displayMode);
  const otherPercent = getDisplayPercent(window, displayMode === "remaining" ? "used" : "remaining");
  const reset = window.resetsInSeconds === undefined ? "重置时间未知" : `${formatResetTime(window.resetsInSeconds)} 后重置`;
  tooltip.appendMarkdown(`**${label}**：${displayLabel} **${displayPercent.toFixed(1)}%**，${otherLabel} ${otherPercent.toFixed(1)}%（${reset}）。\n\n`);
}

function getDisplayPercent(window: ClaudeUsageWindow, mode: UsageDisplayMode): number {
  return mode === "remaining" ? window.remainingPercent : window.usedPercent;
}

function getClaudeUsageDisplayMode(): UsageDisplayMode {
  const configured = vscode.workspace
    .getConfiguration("codexTaskCompanion.claude")
    .get<string>("usageDisplayMode", "remaining");
  return configured === "used" ? "used" : "remaining";
}

async function resolveClaudeCredentialsUris(): Promise<vscode.Uri[]> {
  const config = vscode.workspace.getConfiguration("codexTaskCompanion.claude");
  const configured = config.get<string>("credentialsPath", "").trim();

  if (isRemoteWindow()) {
    const reference = getRemoteWorkspaceReference();
    if (!reference) return [];
    const uri = configured
      ? await resolveConfiguredCredentialUri(configured, reference)
      : await resolveRemoteCredentialUri(reference, {
        configDirectoryVariable: "CLAUDE_CONFIG_DIR",
        defaultDirectoryName: ".claude",
        fileName: ".credentials.json",
      });
    return uri ? [uri] : [];
  }

  if (configured) {
    const uri = await resolveConfiguredCredentialUri(configured);
    return uri ? [uri] : [];
  }

  const configuredDirectory = process.env.CLAUDE_CONFIG_DIR?.trim();
  const claudeConfigDirectory = configuredDirectory
    ? path.resolve(configuredDirectory)
    : path.join(os.homedir(), ".claude");
  return [vscode.Uri.file(path.join(claudeConfigDirectory, ".credentials.json"))];
}

function getClaudeProxyUrl(): string {
  return vscode.workspace.getConfiguration("codexTaskCompanion.claude").get<string>("proxyUrl", "").trim();
}

function parseProxy(proxyUrl: string): AxiosProxyConfig | false | undefined {
  if (!proxyUrl.trim()) return undefined;
  try {
    const url = new URL(proxyUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const proxy: AxiosProxyConfig = {
      protocol: url.protocol.slice(0, -1),
      host: url.hostname,
      port: Number(url.port || (url.protocol === "https:" ? 443 : 80)),
    };
    if (url.username || url.password) {
      proxy.auth = {
        username: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
      };
    }
    return proxy;
  } catch {
    return false;
  }
}

function parseResetTimestamp(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 100000000000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, "\\$&");
}
