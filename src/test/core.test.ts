import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_IGNORED_TERMINAL_COMMANDS,
  isClaudeMainTaskCompletion,
  isChildSessionMeta,
  remainingPercent,
  shouldNotifyTerminalCommand,
} from "../core";

test("remainingPercent converts and clamps used percentage", () => {
  assert.equal(remainingPercent(25), 75);
  assert.equal(remainingPercent(120), 0);
  assert.equal(remainingPercent(-10), 100);
});

test("terminal command filtering ignores common shell commands", () => {
  assert.equal(shouldNotifyTerminalCommand("ls -la"), false);
  assert.equal(shouldNotifyTerminalCommand("ll"), false);
  assert.equal(shouldNotifyTerminalCommand("pwd"), false);
  assert.equal(shouldNotifyTerminalCommand("/usr/bin/ls -la"), false);
  assert.equal(shouldNotifyTerminalCommand("sudo ls"), false);
  assert.equal(shouldNotifyTerminalCommand("ls && pwd"), false);
  assert.equal(DEFAULT_IGNORED_TERMINAL_COMMANDS.includes("ls"), true);
});

test("terminal command filtering notifies for other commands", () => {
  assert.equal(shouldNotifyTerminalCommand("python train.py"), true);
  assert.equal(shouldNotifyTerminalCommand("npm run build"), true);
  assert.equal(shouldNotifyTerminalCommand("git status"), true);
  assert.equal(shouldNotifyTerminalCommand("sudo npm test"), true);
  assert.equal(shouldNotifyTerminalCommand("APP_ENV=test npm test"), true);
  assert.equal(shouldNotifyTerminalCommand("cd project && npm test"), true);
  assert.equal(shouldNotifyTerminalCommand("ls && npm test"), true);
});

test("terminal command filtering accepts a custom ignored-command list", () => {
  assert.equal(shouldNotifyTerminalCommand("npm run build", ["npm"]), false);
  assert.equal(shouldNotifyTerminalCommand("npm run build", ["ls"]), true);
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
