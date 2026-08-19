import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_IGNORED_TERMINAL_COMMANDS,
  formatQuotaStatus,
  formatResetDateTime,
  isClaudeMainTaskCompletion,
  isChildSessionMeta,
  remainingPercent,
  shouldNotifyTerminalCommand,
} from "../core";
import {
  inferRemoteHomePath,
  normalizeRemoteAbsolutePath,
  parseRemotePathEnvironment,
} from "../credentialPathCore";

test("remainingPercent converts and clamps used percentage", () => {
  assert.equal(remainingPercent(25), 75);
  assert.equal(remainingPercent(120), 0);
  assert.equal(remainingPercent(-10), 100);
});

test("formatResetDateTime renders the local reset month, day, hour, and minute", () => {
  const referenceTime = new Date(2026, 7, 19, 23, 30, 0);
  assert.equal(formatResetDateTime(60 * 60, referenceTime), "8-20 00:30");
  assert.equal(formatResetDateTime(0, referenceTime), "8-19 23:30");
  assert.equal(formatResetDateTime(undefined, referenceTime), undefined);
});

test("formatQuotaStatus keeps the status bar and tooltip summary identical", () => {
  const referenceTime = new Date(2026, 7, 20, 10, 24, 0);
  assert.deepEqual(formatQuotaStatus(5.4, "remaining", 60 * 60, referenceTime), {
    percentageText: "5%",
    modeLabel: "left",
    resetDateTime: "8-20 11:24",
    statusText: "5% left | 8-20 11:24",
  });
  assert.equal(
    formatQuotaStatus(25, "used", undefined, referenceTime)?.statusText,
    "25% used | --",
  );
});

test("remote environment parsing retains only credential path variables", () => {
  const parsed = parseRemotePathEnvironment([
    "HOME=/home/alice",
    "CODEX_HOME=/srv/alice/codex",
    "CLAUDE_CONFIG_DIR=/srv/alice/claude",
    "OPENAI_API_KEY=must-not-be-retained",
    "SECRET_TOKEN=must-not-be-retained",
  ].join("\0"));

  assert.deepEqual(parsed, {
    HOME: "/home/alice",
    CODEX_HOME: "/srv/alice/codex",
    CLAUDE_CONFIG_DIR: "/srv/alice/claude",
  });
  assert.equal("OPENAI_API_KEY" in parsed, false);
  assert.equal("SECRET_TOKEN" in parsed, false);
});

test("remote home inference never scans or guesses unrelated users", () => {
  assert.equal(inferRemoteHomePath("/home/alice/project"), "/home/alice");
  assert.equal(inferRemoteHomePath("/Users/alice/project"), "/Users/alice");
  assert.equal(inferRemoteHomePath("/root/project"), "/root");
  assert.equal(inferRemoteHomePath("/srv/project"), undefined);
  assert.equal(inferRemoteHomePath("/mnt/c/Users/Alice/project"), undefined);
});

test("remote Windows paths are normalized without changing environments", () => {
  assert.equal(normalizeRemoteAbsolutePath("C:\\Users\\Alice\\project"), "/C:/Users/Alice/project");
  assert.equal(inferRemoteHomePath("C:\\Users\\Alice\\project"), "/C:/Users/Alice");
  assert.equal(normalizeRemoteAbsolutePath("relative/path"), undefined);
});

test("terminal command filtering defaults to Python commands", () => {
  assert.equal(shouldNotifyTerminalCommand("python train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("python3 train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("python3.12 train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("py -3 train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("pythonw train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("/opt/conda/envs/mocov3/bin/python -u /work/train.py"), true);
  assert.equal(shouldNotifyTerminalCommand(
    "/opt/conda/envs/mocov3/bin/python -u /work/extract.py \\\n" +
    "  --input-parquet /work/train.parquet \\\n" +
    "  --workers 16",
  ), true);
  assert.equal(shouldNotifyTerminalCommand("cd project && /opt/conda/bin/python train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("echo python"), false);
  assert.equal(shouldNotifyTerminalCommand("npm run build"), false);
  assert.equal(shouldNotifyTerminalCommand("git status"), false);
});

test("terminal command filtering ignores common shell commands in all-command mode", () => {
  assert.equal(shouldNotifyTerminalCommand("ls -la", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
  assert.equal(shouldNotifyTerminalCommand("ll", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
  assert.equal(shouldNotifyTerminalCommand("pwd", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
  assert.equal(shouldNotifyTerminalCommand("/usr/bin/ls -la", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
  assert.equal(shouldNotifyTerminalCommand("sudo ls", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
  assert.equal(shouldNotifyTerminalCommand("ls && pwd", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
  assert.equal(DEFAULT_IGNORED_TERMINAL_COMMANDS.includes("ls"), true);
});

test("terminal command filtering can restore all-command mode", () => {
  assert.equal(shouldNotifyTerminalCommand("npm run build", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
  assert.equal(shouldNotifyTerminalCommand("git status", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
  assert.equal(shouldNotifyTerminalCommand("sudo npm test", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
  assert.equal(shouldNotifyTerminalCommand("APP_ENV=test npm test", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
  assert.equal(shouldNotifyTerminalCommand("cd project && npm test", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
  assert.equal(shouldNotifyTerminalCommand("ls && npm test", DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
});

test("terminal command filtering accepts a custom ignored-command list", () => {
  assert.equal(shouldNotifyTerminalCommand("python train.py", ["python"]), false);
  assert.equal(shouldNotifyTerminalCommand("npm run build", ["npm"], false), false);
  assert.equal(shouldNotifyTerminalCommand("npm run build", ["ls"], false), true);
});

test("subagent session metadata is filtered", () => {
  assert.equal(isChildSessionMeta({ parent_thread_id: "parent" }), true);
  assert.equal(isChildSessionMeta({ thread_source: "subagent" }), true);
  assert.equal(isChildSessionMeta({ source: { subagent: { thread_spawn: {} } } }), true);
  assert.equal(isChildSessionMeta({ source: "cli", cwd: "/tmp" }), false);
});

test("Claude main-turn completion detection ignores sidechains", () => {
  assert.equal(isClaudeMainTaskCompletion({
    type: "assistant",
    isSidechain: false,
    message: { stop_reason: "end_turn" },
  }), true);
  assert.equal(isClaudeMainTaskCompletion({
    type: "assistant",
    isSidechain: true,
    message: { stop_reason: "end_turn" },
  }), false);
  assert.equal(isClaudeMainTaskCompletion({
    type: "assistant",
    isSidechain: false,
    message: { stop_reason: "tool_use" },
  }), false);
});
