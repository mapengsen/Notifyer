import axios, { AxiosProxyConfig } from "axios";
import * as os from "os";
import * as path from "path";
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

interface AuthData {
  accessToken: string;
  accountId?: string;
  email: string;
  planType: string;
}

export interface UsageWindow {
  usedPercent: number;
  remainingPercent: number;
  windowMinutes?: number;
  resetsInSeconds?: number;
}

export interface UsageSnapshot {
  primary?: UsageWindow;
  secondary?: UsageWindow;
  email: string;
  planType: string;
  updatedAt: Date;
}

export type UsageDisplayMode = "remaining" | "used";

interface RawUsageWindow {
  used_percent?: unknown;
  limit_window_seconds?: unknown;
  reset_after_seconds?: unknown;
  reset_at?: unknown;
}

class CodexAuthenticationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CodexAuthenticationError";
  }
}

export class UsageMonitor implements vscode.Disposable {
  private readonly statusBar: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private inFlight = false;
  private snapshot: UsageSnapshot | undefined;
  private lastError = "";
  private displayMode: UsageDisplayMode = getUsageDisplayMode();
  private readonly refreshCadence = new UsageRefreshCadence();

  public constructor() {
    this.statusBar = vscode.window.createStatusBarItem(
      "codexUsage",
      vscode.StatusBarAlignment.Right,
      90,
    );
    this.statusBar.name = "Notifyer: Codex quota";
    this.statusBar.command = "codexTaskCompanion.refreshUsage";
    this.statusBar.text = "$(codex-blossom) Codex --";
    this.statusBar.tooltip = "Codex 额度正在加载…";
  }

  public start(): void {
    void this.refresh().finally(() => this.scheduleNext());
  }

  public async refresh(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const auths = await loadAuthDataCandidates();
      if (!auths.length) {
        this.snapshot = undefined;
        this.lastError = "当前 VS Code 环境中未找到可用的 Codex 登录凭据";
        this.renderAuthRequired();
        return;
      }

      let lastUsageError = "";
      for (const auth of auths) {
        try {
          const usage = await fetchUsage(auth, getProxyUrl());
          if (!usage.primary && !usage.secondary) {
            lastUsageError = "Codex usage 接口没有返回有效窗口";
            continue;
          }

          this.snapshot = {
            ...usage,
            email: auth.email,
            planType: auth.planType,
            updatedAt: new Date(),
          };
          this.lastError = "";
          this.renderSnapshot(this.snapshot);
          return;
        } catch (error) {
          if (error instanceof CodexAuthenticationError) {
            lastUsageError = error.message;
            continue;
          }
          lastUsageError = error instanceof Error ? error.message : String(error);
        }
      }

      this.snapshot = undefined;
      this.lastError = lastUsageError || "Codex credentials are invalid or expired.";
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

  public getDiagnostics(): Record<string, unknown> {
    return {
      hasSnapshot: Boolean(this.snapshot),
      lastError: this.lastError,
      displayMode: this.displayMode,
      startupRefreshesRemaining: this.refreshCadence.startupRefreshesRemaining,
      updatedAt: this.snapshot?.updatedAt.toISOString() ?? "",
      primaryRemainingPercent: this.snapshot?.primary?.remainingPercent,
      secondaryRemainingPercent: this.snapshot?.secondary?.remainingPercent,
    };
  }

  public async chooseDisplayMode(): Promise<void> {
    const selected = await vscode.window.showQuickPick([
      {
        label: "Remaining",
        description: "Show the percentage that is still available (default)",
        value: "remaining" as const,
      },
      {
        label: "Used",
        description: "Show the percentage that has already been used",
        value: "used" as const,
      },
    ], {
      placeHolder: "Choose the Codex quota display",
    });
    if (!selected) return;

    await vscode.workspace
      .getConfiguration("codexTaskCompanion.codex")
      .update("usageDisplayMode", selected.value, vscode.ConfigurationTarget.Global);
  }

  public reloadConfiguration(): void {
    this.displayMode = getUsageDisplayMode();
    if (this.snapshot) {
      this.renderSnapshot(this.snapshot);
    }
    this.scheduleNext();
  }

  public dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.statusBar.dispose();
  }

  private scheduleNext(): void {
    if (this.timer) clearTimeout(this.timer);
    const regularIntervalSeconds = vscode.workspace
      .getConfiguration("codexTaskCompanion.codex")
      .get<number>("usageUpdateIntervalSeconds", DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS);
    const seconds = this.refreshCadence.getDelaySeconds(regularIntervalSeconds);
    this.timer = setTimeout(() => {
      this.refreshCadence.consumeScheduledRefresh();
      void this.refresh().finally(() => this.scheduleNext());
    }, seconds * 1000);
  }

  private renderSnapshot(snapshot: UsageSnapshot): void {
    const primary = snapshot.primary ?? snapshot.secondary;
    const displayPercent = primary ? getDisplayPercent(primary, this.displayMode) : undefined;
    const presentation = primary && displayPercent !== undefined
      ? formatQuotaStatus(displayPercent, this.displayMode, primary.resetsInSeconds, snapshot.updatedAt)
      : undefined;
    this.statusBar.text = presentation
      ? `$(codex-blossom) ${presentation.statusText}`
      : "$(codex-blossom) Codex --";
    this.statusBar.show();
    this.statusBar.color = undefined;
    this.statusBar.backgroundColor = undefined;
    this.statusBar.tooltip = buildUsageTooltip(snapshot, this.displayMode);
  }

  private renderAuthRequired(): void {
    this.statusBar.text = "$(codex-blossom) Codex --";
    this.statusBar.hide();
    this.statusBar.color = new vscode.ThemeColor("editorWarning.foreground");
    this.statusBar.tooltip = "当前 VS Code 环境中未找到或无法使用 Codex 登录信息。请在当前环境运行 codex login，然后点击刷新。";
  }

  private renderError(): void {
    this.statusBar.text = "$(codex-blossom) Codex ?";
    this.statusBar.show();
    this.statusBar.color = new vscode.ThemeColor("editorWarning.foreground");
    this.statusBar.tooltip = `无法读取 Codex 额度。点击刷新重试。\n\n${this.lastError}`;
  }

}

async function loadAuthDataCandidates(): Promise<AuthData[]> {
  const auths: AuthData[] = [];
  const seenTokens = new Set<string>();
  for (const uri of await resolveCodexAuthUris()) {
    const auth = await loadAuthDataFromUri(uri);
    if (auth && !seenTokens.has(auth.accessToken)) {
      seenTokens.add(auth.accessToken);
      auths.push(auth);
    }
  }

  return auths;
}

async function loadAuthDataFromUri(uri: vscode.Uri): Promise<AuthData | undefined> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return parseAuthData(Buffer.from(bytes).toString("utf8"));
  } catch {
    return undefined;
  }
}

function parseAuthData(text: string): AuthData | undefined {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const tokens = parsed.tokens as Record<string, unknown> | undefined;
    const accessToken = typeof tokens?.access_token === "string" ? tokens.access_token : "";
    if (!accessToken) return undefined;
    const idToken = typeof tokens?.id_token === "string" ? tokens.id_token : "";
    const idPayload = parseJwt(idToken);
    const authClaims = idPayload["https://api.openai.com/auth"] as Record<string, unknown> | undefined;
    return {
      accessToken,
      accountId: typeof tokens?.account_id === "string" ? tokens.account_id : undefined,
      email: typeof idPayload.email === "string" ? idPayload.email : "Unknown",
      planType: typeof authClaims?.chatgpt_plan_type === "string" ? authClaims.chatgpt_plan_type : "Unknown",
    };
  } catch {
    return undefined;
  }
}

async function resolveCodexAuthUris(): Promise<vscode.Uri[]> {
  const configuredPath = vscode.workspace
    .getConfiguration("codexTaskCompanion.codex")
    .get<string>("credentialsPath", "")
    .trim();

  if (isRemoteWindow()) {
    const reference = getRemoteWorkspaceReference();
    if (!reference) return [];
    const uri = configuredPath
      ? await resolveConfiguredCredentialUri(configuredPath, reference)
      : await resolveRemoteCredentialUri(reference, {
        configDirectoryVariable: "CODEX_HOME",
        defaultDirectoryName: ".codex",
        fileName: "auth.json",
      });
    return uri ? [uri] : [];
  }

  if (configuredPath) {
    const uri = await resolveConfiguredCredentialUri(configuredPath);
    return uri ? [uri] : [];
  }

  const configuredHome = process.env.CODEX_HOME?.trim();
  const codexHome = configuredHome
    ? path.resolve(configuredHome)
    : path.join(os.homedir(), ".codex");
  return [vscode.Uri.file(path.join(codexHome, "auth.json"))];
}

function parseJwt(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function fetchUsage(auth: AuthData, proxyUrl: string): Promise<Pick<UsageSnapshot, "primary" | "secondary">> {
  const response = await axios.get("https://chatgpt.com/backend-api/wham/usage", {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${auth.accessToken}`,
      "User-Agent": "Notifyer/0.2.11",
      ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
    },
    proxy: parseProxy(proxyUrl),
    timeout: 15000,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    if (response.status === 401 || response.status === 403) {
      throw new CodexAuthenticationError("Codex credentials are invalid or expired.");
    }
    throw new Error(`usage 请求失败（HTTP ${response.status}）`);
  }

  const rateLimit = response.data?.rate_limit as Record<string, unknown> | undefined;
  return {
    primary: parseUsageWindow(rateLimit?.primary_window),
    secondary: parseUsageWindow(rateLimit?.secondary_window),
  };
}

function parseUsageWindow(raw: unknown): UsageWindow | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const value = raw as RawUsageWindow;
  const used = finiteNumber(value.used_percent);
  if (used === undefined) return undefined;
  const windowSeconds = finiteNumber(value.limit_window_seconds);
  const resetAfter = finiteNumber(value.reset_after_seconds);
  const resetAt = finiteNumber(value.reset_at);
  const calculatedReset = resetAfter ?? (resetAt === undefined
    ? undefined
    : Math.max(0, Math.round(resetAt - Date.now() / 1000)));
  return {
    usedPercent: clampPercent(used),
    remainingPercent: remainingPercent(used),
    windowMinutes: windowSeconds === undefined ? undefined : windowSeconds / 60,
    resetsInSeconds: calculatedReset,
  };
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
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

function getProxyUrl(): string {
  return vscode.workspace.getConfiguration("codexTaskCompanion.codex").get<string>("proxyUrl", "").trim();
}

function getUsageDisplayMode(): UsageDisplayMode {
  const configured = vscode.workspace
    .getConfiguration("codexTaskCompanion.codex")
    .get<string>("usageDisplayMode", "remaining");
  return configured === "used" ? "used" : "remaining";
}

function getDisplayPercent(window: UsageWindow, mode: UsageDisplayMode): number {
  return mode === "remaining" ? window.remainingPercent : window.usedPercent;
}

function buildUsageTooltip(snapshot: UsageSnapshot, displayMode: UsageDisplayMode): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString();
  tooltip.isTrusted = true;
  const displayLabel = displayMode === "remaining" ? "剩余" : "已使用";
  tooltip.appendMarkdown(`**Codex ${displayLabel}额度**\n\n`);
  const primary = snapshot.primary ?? snapshot.secondary;
  const primaryLabel = snapshot.primary ? "短窗口" : "长窗口";
  if (primary) {
    appendStatusBarMeaning(tooltip, primaryLabel, primary, displayMode, snapshot.updatedAt);
  }
  tooltip.appendMarkdown(`账户：${escapeMarkdown(snapshot.email)}\n\n`);
  tooltip.appendMarkdown(`套餐：${escapeMarkdown(snapshot.planType)}\n\n`);
  tooltip.appendMarkdown("> 这里显示的是当前时间窗口的百分比，不是绝对请求数或 Token 数。\n\n");
  appendWindow(tooltip, "短窗口", snapshot.primary, displayMode);
  appendWindow(tooltip, "长窗口", snapshot.secondary, displayMode);
  tooltip.appendMarkdown(`\n最后更新：${snapshot.updatedAt.toLocaleTimeString()}\n\n`);
  tooltip.appendMarkdown("[立即刷新](command:codexTaskCompanion.refreshUsage) · [切换显示](command:codexTaskCompanion.chooseUsageDisplayMode) · [打开设置](command:codexTaskCompanion.openSettings)");
  return tooltip;
}

function appendStatusBarMeaning(
  tooltip: vscode.MarkdownString,
  windowLabel: string,
  window: UsageWindow,
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
  tooltip.appendMarkdown("> Codex 状态栏优先展示短窗口；短窗口不可用时才展示长窗口。\n\n");
}

function appendWindow(
  tooltip: vscode.MarkdownString,
  label: string,
  window: UsageWindow | undefined,
  displayMode: UsageDisplayMode,
): void {
  if (!window) return;
  const duration = window.windowMinutes === undefined
    ? "未知窗口"
    : window.windowMinutes >= 1440
      ? `${Math.round(window.windowMinutes / 1440)} 天`
      : `${Math.round(window.windowMinutes / 60)} 小时`;
  const reset = window.resetsInSeconds === undefined ? "未知" : formatResetTime(window.resetsInSeconds);
  const displayLabel = displayMode === "remaining" ? "剩余" : "已使用";
  const otherLabel = displayMode === "remaining" ? "已使用" : "剩余";
  const displayPercent = getDisplayPercent(window, displayMode);
  const otherPercent = getDisplayPercent(window, displayMode === "remaining" ? "used" : "remaining");
  tooltip.appendMarkdown(`**${label}（${duration}）**：${displayLabel} **${displayPercent.toFixed(1)}%**，${otherLabel} ${otherPercent.toFixed(1)}%，${reset} 后重置。\n\n`);
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}[\]()#+.!|<>-]/g, "\\$&");
}
