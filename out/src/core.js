"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_IGNORED_TERMINAL_COMMANDS = void 0;
exports.isDesktopNotificationActivation = isDesktopNotificationActivation;
exports.stripAnsi = stripAnsi;
exports.shouldNotifyTerminalCommand = shouldNotifyTerminalCommand;
exports.isChildSessionMeta = isChildSessionMeta;
exports.mergeChildSessionClassification = mergeChildSessionClassification;
exports.isClaudeMainTaskCompletion = isClaudeMainTaskCompletion;
exports.normalizeTimestamp = normalizeTimestamp;
exports.truncate = truncate;
exports.remoteHomeFromWorkspacePath = remoteHomeFromWorkspacePath;
exports.projectNameFromCwd = projectNameFromCwd;
exports.normalizeWorkspacePath = normalizeWorkspacePath;
exports.workspacePathsOverlap = workspacePathsOverlap;
exports.shouldNotifySessionCompletion = shouldNotifySessionCompletion;
exports.normalizeTokenUsage = normalizeTokenUsage;
exports.buildTokenDelta = buildTokenDelta;
const ANSI_ESCAPE = /[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
exports.DEFAULT_IGNORED_TERMINAL_COMMANDS = [
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
];
const DESKTOP_NOTIFICATION_NON_ACTIVATIONS = new Set([
    "close",
    "closed",
    "dismiss",
    "dismissed",
    "error",
    "failed",
    "hidden",
    "timeout",
    "timedout",
]);
/**
 * Windows notification helpers do not use one stable activation value across
 * every toast path/version. Treat any reported user action as activation while
 * explicitly excluding timeout, dismissal, and failure results.
 */
function isDesktopNotificationActivation(...values) {
    for (const value of values) {
        if (typeof value !== "string")
            continue;
        const normalized = value.trim().toLowerCase();
        if (!normalized || DESKTOP_NOTIFICATION_NON_ACTIVATIONS.has(normalized))
            continue;
        return true;
    }
    return false;
}
function stripAnsi(value) {
    return value.replace(ANSI_ESCAPE, "");
}
function shouldNotifyTerminalCommand(commandLine, ignoredCommands = exports.DEFAULT_IGNORED_TERMINAL_COMMANDS, pythonOnly = true) {
    const cleanCommand = stripAnsi(commandLine).trim();
    if (!cleanCommand)
        return false;
    const ignored = new Set(ignoredCommands
        .map((command) => normalizeCommandName(command))
        .filter((command) => Boolean(command)));
    const commandNames = splitCommandSegments(cleanCommand)
        .map(getCommandName)
        .filter((command) => Boolean(command));
    const notificationCandidates = pythonOnly
        ? commandNames.filter(isPythonCommandName)
        : commandNames;
    return notificationCandidates.some((command) => !ignored.has(command));
}
function isPythonCommandName(command) {
    return command === "py" || /^pythonw?(?:\d+(?:\.\d+)*)?$/.test(command);
}
function splitCommandSegments(commandLine) {
    const segments = [];
    let segment = "";
    let quote;
    for (let index = 0; index < commandLine.length; index += 1) {
        const character = commandLine[index];
        if ((character === "'" || character === '"') && (!quote || quote === character)) {
            quote = quote ? undefined : character;
            segment += character;
            continue;
        }
        if (!quote && (character === ";" || character === "|" || character === "&")) {
            if (segment.trim())
                segments.push(segment);
            segment = "";
            if (commandLine[index + 1] === character && (character === "|" || character === "&")) {
                index += 1;
            }
            continue;
        }
        segment += character;
    }
    if (segment.trim())
        segments.push(segment);
    return segments;
}
function getCommandName(segment) {
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
function tokenizeCommand(segment) {
    const tokens = [];
    let token = "";
    let quote;
    const pushToken = () => {
        if (token)
            tokens.push(token);
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
function isEnvironmentAssignment(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=.*/.test(token);
}
function isRedirection(token) {
    return /^(?:\d*(?:>>?|<<|<>|<&|>&)|[<>])/.test(token);
}
function isCommandPrefix(command) {
    return command === "sudo" ||
        command === "env" ||
        command === "command" ||
        command === "exec" ||
        command === "time" ||
        command === "nohup" ||
        command === "nice" ||
        command === "timeout";
}
function normalizeCommandName(value) {
    const clean = value
        .replace(/^[`"'(]+|[`"'),]+$/g, "")
        .split(/[\\/]/)
        .pop()
        ?.toLowerCase()
        .replace(/\.exe$/, "");
    return clean || undefined;
}
function isChildSessionMeta(meta) {
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
function mergeChildSessionClassification(currentIsChild, meta) {
    return currentIsChild || isChildSessionMeta(meta);
}
function isClaudeMainTaskCompletion(record) {
    if (record.type !== "assistant" || record.isSidechain === true || record.isApiErrorMessage === true) {
        return false;
    }
    const message = record.message;
    if (!message || typeof message !== "object" || Array.isArray(message)) {
        return false;
    }
    return message.stop_reason === "end_turn";
}
function normalizeTimestamp(value) {
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
function truncate(value, maxLength = 180) {
    const clean = value?.replace(/\s+/g, " ").trim() ?? "";
    if (clean.length <= maxLength) {
        return clean;
    }
    return `${clean.slice(0, Math.max(0, maxLength - 1))}…`;
}
/** Infer the user home from standard or mounted home paths without enumerating other users. */
function remoteHomeFromWorkspacePath(workspacePath) {
    return workspacePath.match(/^\/(?:[^/]+\/)*?(?:home|Users)\/[^/]+/)?.[0]
        ?? (workspacePath === "/root" || workspacePath.startsWith("/root/") ? "/root" : undefined);
}
function projectNameFromCwd(cwd) {
    const normalized = cwd?.replace(/[\\/]+$/, "") ?? "";
    if (!normalized) {
        return "workspace";
    }
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || "workspace";
}
function normalizeWorkspacePath(value) {
    let normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
    const wslDrive = normalized.match(/^\/mnt\/([A-Za-z])(?=\/|$)/);
    if (wslDrive) {
        normalized = `${wslDrive[1].toLowerCase()}:${normalized.slice(6)}`;
    }
    if (/^[A-Za-z]:/.test(normalized)) {
        normalized = normalized.toLowerCase();
    }
    return normalized || "/";
}
function workspacePathsOverlap(first, second) {
    const left = normalizeWorkspacePath(first);
    const right = normalizeWorkspacePath(second);
    if (left === right)
        return true;
    if (left === "/")
        return right.startsWith("/");
    if (right === "/")
        return left.startsWith("/");
    return left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}
/**
 * Initial session scans establish a baseline and must remain silent unless the
 * user explicitly opted into historical notifications. Event timestamps are
 * intentionally ignored because local and remote clocks may disagree.
 */
function shouldNotifySessionCompletion(emitNotifications, notifyInitialScan) {
    return emitNotifications || notifyInitialScan;
}
function normalizeTokenUsage(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const value = raw;
    const result = {
        inputTokens: finiteNumber(value.input_tokens),
        cachedInputTokens: finiteNumber(value.cached_input_tokens),
        outputTokens: finiteNumber(value.output_tokens),
        reasoningOutputTokens: finiteNumber(value.reasoning_output_tokens),
        totalTokens: finiteNumber(value.total_tokens),
    };
    return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}
function buildTokenDelta(current, previous) {
    if (!current) {
        return undefined;
    }
    if (!previous) {
        return { ...current };
    }
    const subtract = (now, before) => {
        if (now === undefined)
            return undefined;
        if (before === undefined)
            return now;
        return now >= before ? now - before : undefined;
    };
    const result = {
        inputTokens: subtract(current.inputTokens, previous.inputTokens),
        cachedInputTokens: subtract(current.cachedInputTokens, previous.cachedInputTokens),
        outputTokens: subtract(current.outputTokens, previous.outputTokens),
        reasoningOutputTokens: subtract(current.reasoningOutputTokens, previous.reasoningOutputTokens),
        totalTokens: subtract(current.totalTokens, previous.totalTokens),
    };
    return Object.values(result).some((item) => item !== undefined) ? result : undefined;
}
function finiteNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    return undefined;
}
