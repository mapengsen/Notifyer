const ANSI_ESCAPE = /[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;

export const DEFAULT_PYTHON_COMMAND_PATTERN =
  String.raw`(?:^|[\s;&|"'(/\\])(?:python(?:\.exe|\d+(?:\.\d+)*)?|py(?:\.exe)?)(?=\s|$)`;

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

export function compilePattern(pattern: string): RegExp | undefined {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return undefined;
  }
}

export function isPythonCommand(
  commandLine: string,
  pattern = DEFAULT_PYTHON_COMMAND_PATTERN,
): boolean {
  const cleanCommand = stripAnsi(commandLine).trim();
  if (pattern === DEFAULT_PYTHON_COMMAND_PATTERN) {
    return isDefaultPythonCommand(cleanCommand);
  }
  const regex = compilePattern(pattern) ?? compilePattern(DEFAULT_PYTHON_COMMAND_PATTERN);
  if (!regex) {
    return false;
  }
  regex.lastIndex = 0;
  return regex.test(cleanCommand);
}

function isDefaultPythonCommand(commandLine: string): boolean {
  const segments = commandLine.split(/&&|\|\||[;|]/g);
  for (const segment of segments) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;

    let index = 0;
    while (index < tokens.length && isCommandPrefix(tokens[index])) {
      index += 1;
    }

    if (tokens[index] === "uv" || tokens[index] === "poetry" || tokens[index] === "conda") {
      if (tokens[index + 1]?.toLowerCase() === "run") index += 2;
    }

    if (isPythonExecutable(tokens[index])) return true;
  }
  return false;
}

function isCommandPrefix(token: string): boolean {
  const clean = token.replace(/^[`"']+|[`"']+$/g, "");
  return clean === "sudo" || clean === "env" || clean === "command" || clean === "time" || clean === "nohup" || /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(clean);
}

function isPythonExecutable(token: string | undefined): boolean {
  if (!token) return false;
  const clean = token
    .replace(/^[`"'(]+|[`"'),]+$/g, "")
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase();
  return clean ? /^(?:python(?:\.exe|\d+(?:\.\d+)*)?|py(?:\.exe)?)$/.test(clean) : false;
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
