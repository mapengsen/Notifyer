import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_IGNORED_TERMINAL_COMMANDS,
  isClaudeMainTaskCompletion,
  isChildSessionMeta,
  shouldNotifyTerminalCommand,
} from "../core";

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
