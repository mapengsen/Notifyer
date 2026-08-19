const ANSI_ESCAPE = /[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export const DEFAULT_IGNORED_TERMINAL_COMMANDS = [
  "alias",
  "bg",
  "cat",
  "cd",
  "clear",
  "cls",
  "command",
  "date",
  "df",
  "dirs",
  "du",
  "echo",
  "dir",
  "exit",
  "false",
  "fg",
  "free",
  "head",
  "help",
  "history",
  "id",
  "jobs",
  "l",
  "la",
  "less",
  "ll",
  "ls",
  "logout",
  "man",
  "more",
  "popd",
  "printf",
  "pwd",
  "pushd",
  "set",
  "source",
  "tail",
  "true",
  "type",
  "unalias",
  "uname",
  "unset",
  "uptime",
  "whoami",
  "which",
  "where",
] as const;

export function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, "");
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, value));
}

export function remainingPercent(usedPercent: number): number {
  return clampPercent(100 - clampPercent(usedPercent));
}

export function shouldNotifyTerminalCommand(
  commandLine: string,
  ignoredCommands: readonly string[] = DEFAULT_IGNORED_TERMINAL_COMMANDS,
  pythonOnly = true,
): boolean {
  const cleanCommand = stripAnsi(commandLine).trim();
  if (!cleanCommand) return false;

  const ignored = new Set(
    ignoredCommands
      .map((command) => normalizeCommandName(command))
      .filter((command): command is string => Boolean(command)),
  );
  const commandNames = splitCommandSegments(cleanCommand)
    .map(getCommandName)
    .filter((command): command is string => Boolean(command));
  const notificationCandidates = pythonOnly
    ? commandNames.filter(isPythonCommandName)
    : commandNames;

  return notificationCandidates.some((command) => !ignored.has(command));
}

function isPythonCommandName(command: string): boolean {
  return command === "py" || /^pythonw?(?:\d+(?:\.\d+)*)?$/.test(command);
}

function splitCommandSegments(commandLine: string): string[] {
  const segments: string[] = [];
  let segment = "";
  let quote: "'" | '"' | undefined;

  for (let index = 0; index < commandLine.length; index += 1) {
    const character = commandLine[index];
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? undefined : character;
      segment += character;
      continue;
    }

    if (!quote && (character === ";" || character === "|" || character === "&")) {
      if (segment.trim()) segments.push(segment);
      segment = "";
      if (commandLine[index + 1] === character && (character === "|" || character === "&")) {
        index += 1;
      }
      continue;
    }

    segment += character;
  }

  if (segment.trim()) segments.push(segment);
  return segments;
}

function getCommandName(segment: string): string | undefined {
  const tokens = tokenizeCommand(segment);
  let index = 0;

  while (index < tokens.length) {
    const token = tokens[index];
    if (isEnvironmentAssignment(token) || isRedirection(token)) {
      index += 1;
      continue;
    }

    const normalized = normalizeCommandName(token);
    if (!normalized) {
      index += 1;
      continue;
    }

    if (isCommandPrefix(normalized)) {
      index += 1;
      continue;
    }

    return normalized;
  }

  return undefined;
}

function tokenizeCommand(segment: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | undefined;

  const pushToken = () => {
    if (token) tokens.push(token);
    token = "";
  };

  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if ((character === "'" || character === '"') && (!quote || quote === character)) {
      quote = quote ? undefined : character;
      continue;
    }

    if (!quote && /\s/.test(character)) {
      pushToken();
      continue;
    }

    if (quote === '"' && character === "\\" && segment[index + 1]) {
      token += segment[index + 1];
      index += 1;
      continue;
    }

    token += character;
  }

  pushToken();
  return tokens;
}

function isEnvironmentAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}

function isRedirection(token: string): boolean {
  return /^(?:\d*(?:>>?|<<|<>|<&|>&)|[<>])/.test(token);
}

function isCommandPrefix(command: string): boolean {
  return command === "sudo" ||
    command === "env" ||
    command === "command" ||
    command === "exec" ||
    command === "time" ||
    command === "nohup" ||
    command === "nice" ||
    command === "timeout";
}

function normalizeCommandName(value: string): string | undefined {
  const clean = value
    .replace(/^[`"'(]+|[`"'),]+$/g, "")
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase()
    .replace(/\.exe$/, "");
  return clean || undefined;
}

export function isChildSessionMeta(meta: Record<string, unknown>): boolean {
  if (typeof meta.parent_thread_id === "string" && meta.parent_thread_id.trim()) {
    return true;
  }

  if (meta.thread_source === "subagent") {
    return true;
  }

  if (typeof meta.agent_path === "string" && meta.agent_path.trim()) {
    return true;
  }

  if (typeof meta.agent_role === "string" && meta.agent_role.trim()) {
    return true;
  }

  const source = meta.source;
  if (source === "subagent") {
    return true;
  }
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return Object.prototype.hasOwnProperty.call(source, "subagent");
  }

  return false;
}

export function isClaudeMainTaskCompletion(record: Record<string, unknown>): boolean {
  if (record.type !== "assistant" || record.isSidechain === true) {
    return false;
  }

  const message = record.message;
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return false;
  }

  return (message as Record<string, unknown>).stop_reason === "end_turn";
}

export function formatResetTime(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }
  if (safeSeconds < 3600) {
    return `${Math.floor(safeSeconds / 60)}m`;
  }
  if (safeSeconds < 86400) {
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const days = Math.floor(safeSeconds / 86400);
  const hours = Math.floor((safeSeconds % 86400) / 3600);
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

export function formatResetDateTime(
  secondsUntilReset: number | undefined,
  referenceTime = new Date(),
): string | undefined {
  if (secondsUntilReset === undefined ||
      !Number.isFinite(secondsUntilReset) ||
      !Number.isFinite(referenceTime.getTime())) {
    return undefined;
  }

  const resetTime = new Date(
    referenceTime.getTime() + Math.max(0, secondsUntilReset) * 1000,
  );
  const hours = String(resetTime.getHours()).padStart(2, "0");
  const minutes = String(resetTime.getMinutes()).padStart(2, "0");
  return `${resetTime.getMonth() + 1}-${resetTime.getDate()} ${hours}:${minutes}`;
}

export interface QuotaStatusPresentation {
  percentageText: string;
  modeLabel: "left" | "used";
  resetDateTime?: string;
  statusText: string;
}

export const STARTUP_USAGE_REFRESH_COUNT = 6;
export const STARTUP_USAGE_REFRESH_INTERVAL_SECONDS = 30;
export const DEFAULT_USAGE_REFRESH_INTERVAL_SECONDS = 10 * 60;

export class UsageRefreshCadence {
  private remainingStartupRefreshes = STARTUP_USAGE_REFRESH_COUNT;

  public get startupRefreshesRemaining(): number {
    return this.remainingStartupRefreshes;
  }

  public getDelaySeconds(regularIntervalSeconds: number): number {
    return this.remainingStartupRefreshes > 0
      ? STARTUP_USAGE_REFRESH_INTERVAL_SECONDS
      : Math.max(STARTUP_USAGE_REFRESH_INTERVAL_SECONDS, regularIntervalSeconds);
  }

  public consumeScheduledRefresh(): void {
    if (this.remainingStartupRefreshes > 0) {
      this.remainingStartupRefreshes -= 1;
    }
  }
}

export function formatQuotaStatus(
  percentage: number,
  displayMode: "remaining" | "used",
  secondsUntilReset: number | undefined,
  referenceTime = new Date(),
): QuotaStatusPresentation | undefined {
  if (!Number.isFinite(percentage)) return undefined;
  const percentageText = `${percentage.toFixed(0)}%`;
  const modeLabel = displayMode === "remaining" ? "left" : "used";
  const resetDateTime = formatResetDateTime(secondsUntilReset, referenceTime);
  return {
    percentageText,
    modeLabel,
    resetDateTime,
    statusText: `${percentageText} ${modeLabel} | ${resetDateTime ?? "--"}`,
  };
}

export function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = value > 100000000000 ? value : value * 1000;
    return new Date(timestamp).toISOString();
  }
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

export function truncate(value: string | undefined, maxLength = 180): string {
  const clean = value?.replace(/\s+/g, " ").trim() ?? "";
  if (clean.length <= maxLength) {
    return clean;
  }
  return `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function projectNameFromCwd(cwd: string | undefined): string {
  const normalized = cwd?.replace(/[\\/]+$/, "") ?? "";
  if (!normalized) {
    return "workspace";
  }
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "workspace";
}

export interface TokenUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens?: number;
}

export function normalizeTokenUsage(raw: unknown): TokenUsage | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const value = raw as Record<string, unknown>;
  const result: TokenUsage = {
    inputTokens: finiteNumber(value.input_tokens),
    cachedInputTokens: finiteNumber(value.cached_input_tokens),
    outputTokens: finiteNumber(value.output_tokens),
    reasoningOutputTokens: finiteNumber(value.reasoning_output_tokens),
    totalTokens: finiteNumber(value.total_tokens),
  };
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

export function buildTokenDelta(
  current: TokenUsage | undefined,
  previous: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!current) {
    return undefined;
  }
  if (!previous) {
    return { ...current };
  }
  const subtract = (now: number | undefined, before: number | undefined) => {
    if (now === undefined) return undefined;
    if (before === undefined) return now;
    return now >= before ? now - before : undefined;
  };
  const result: TokenUsage = {
    inputTokens: subtract(current.inputTokens, previous.inputTokens),
    cachedInputTokens: subtract(current.cachedInputTokens, previous.cachedInputTokens),
    outputTokens: subtract(current.outputTokens, previous.outputTokens),
    reasoningOutputTokens: subtract(current.reasoningOutputTokens, previous.reasoningOutputTokens),
    totalTokens: subtract(current.totalTokens, previous.totalTokens),
  };
  return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return undefined;
}
