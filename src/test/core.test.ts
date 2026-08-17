import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PYTHON_COMMAND_PATTERN,
  isClaudeMainTaskCompletion,
  isChildSessionMeta,
  isPythonCommand,
  remainingPercent,
} from "../core";

test("remainingPercent converts and clamps used percentage", () => {
  assert.equal(remainingPercent(25), 75);
  assert.equal(remainingPercent(120), 0);
  assert.equal(remainingPercent(-10), 100);
});

test("python command matching covers common interpreters", () => {
  assert.equal(isPythonCommand("python train.py", DEFAULT_PYTHON_COMMAND_PATTERN), true);
  assert.equal(isPythonCommand("python3.11 -m pytest", DEFAULT_PYTHON_COMMAND_PATTERN), true);
  assert.equal(isPythonCommand("/usr/bin/python3 script.py", DEFAULT_PYTHON_COMMAND_PATTERN), true);
  assert.equal(isPythonCommand("C:\\Python311\\python.exe script.py", DEFAULT_PYTHON_COMMAND_PATTERN), true);
  assert.equal(isPythonCommand("uv run python app.py", DEFAULT_PYTHON_COMMAND_PATTERN), true);
  assert.equal(isPythonCommand("echo python is installed", DEFAULT_PYTHON_COMMAND_PATTERN), false);
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
