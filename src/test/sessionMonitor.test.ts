import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as vm from "node:vm";
import test from "node:test";
import { SessionActivity } from "../sessionActivity";

/** Run the production monitor against a remote filesystem, without a live VS Code host. */
function fixture(provider: "codex" | "claude" = "codex") {
  const home = "/data/home/mapengsen";
  const workspace = `${home}/opticaldna_pixel`;
  const root = `${home}/.${provider === "claude" ? "claude/projects" : "codex/sessions"}`;
  const authority = "ssh-remote+server";
  let clock = Date.now();
  class Uri {
    public constructor(public path: string, public scheme = "vscode-remote", public authority = "ssh-remote+server") {}
    public with(value: { path: string }) { return new Uri(value.path, this.scheme, this.authority); }
    public toString() { return `${this.scheme}://${this.authority}${this.path}`; }
    public static joinPath(base: Uri, ...segments: string[]) { return base.with({ path: path.posix.join(base.path, ...segments) }); }
    public static file(value: string) { return new Uri(value, "file", ""); }
  }
  const nodes = new Map<string, { type: number; text: string; mtime: number }>();
  const directory = (name: string): void => {
    if (nodes.has(name)) return;
    nodes.set(name, { type: 2, text: "", mtime: clock });
    if (name !== "/") directory(path.posix.dirname(name));
  };
  directory(root);
  directory(workspace);
  const reads: string[] = [];
  const activities: SessionActivity[] = [];
  const notifications: string[] = [];
  const api = { Uri, FileType: { File: 1, Directory: 2 },
    workspace: { workspaceFolders: [{ uri: new Uri(workspace) }], getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }),
      fs: {
        readDirectory: async (uri: Uri) => {
          if (uri.scheme !== "vscode-remote" || !nodes.has(uri.path)) throw new Error("Missing directory");
          return [...nodes].filter(([name]) => name !== uri.path && path.posix.dirname(name) === uri.path)
            .map(([name, node]) => [path.posix.basename(name), node.type]);
        },
        stat: async (uri: Uri) => {
          const node = uri.scheme === "vscode-remote" && nodes.get(uri.path);
          if (!node) throw new Error("Missing file");
          return { type: node.type, size: Buffer.byteLength(node.text), mtime: node.mtime };
        },
        readFile: async (uri: Uri) => {
          const node = nodes.get(uri.path);
          assert.ok(node);
          reads.push(uri.path);
          return Buffer.from(node.text);
        },
      },
    },
  };
  const file = path.resolve(__dirname, provider === "claude" ? "../claudeSessionMonitor.js" : "../sessionMonitor.js");
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { exports: module.exports, module, Buffer, console,
    Date: { now: () => clock }, process: { env: {} }, setInterval: () => 1, clearInterval() {},
    require: (name: string) => name === "vscode" ? api : name === "./notify" ? {
      notifyDesktop: async (title: string) => { notifications.push(title); return { delivered: true, outcome: "delivered" }; },
    } : localRequire(name),
  });
  const Monitor = (module.exports as any)[provider === "claude" ? "ClaudeSessionMonitor" : "CodexSessionMonitor"];
  const monitor = new Monitor((activity: SessionActivity) => activities.push(activity));
  const event = (type: string, turnId = "turn-old", extra = {}) => ({ type: "event_msg", timestamp: new Date(clock).toISOString(),
    payload: { type, turn_id: turnId, ...extra } });
  const meta = (id = "session-old") => ({ type: "session_meta", payload: { id, cwd: workspace, source: "vscode" } });
  const write = (name: string, records: unknown[], mtime = clock, newline = "\n") => {
    directory(path.posix.dirname(name));
    nodes.set(name, { type: 1, text: records.map((record) => JSON.stringify(record)).join(newline) + newline, mtime });
  };
  const append = (name: string, records: unknown[], newline = "\n") => {
    const node = nodes.get(name)!;
    node.text += records.map((record) => JSON.stringify(record)).join(newline) + newline;
    node.mtime = ++clock;
  };
  return { root, home, authority, reads, activities, notifications, monitor, event, meta, write, append,
    now: () => clock, tick: () => monitor.poll(true) };
}

test("Codex monitor reconciles superseded historical questions and isolates live questions by conversation", async () => {
  const f = fixture();
  const last = (id: string) => f.activities.filter((activity) => activity.sessionId === id).at(-1);
  const file = `${f.root}/2026/09/17/resumed.jsonl`, other = `${f.root}/2026/10/29/other.jsonl`;
  const request = (turnId: string) => ({ type: "response_item", payload: { type: "function_call", name: "request_user_input_async", call_id: "shared-call-id",
    arguments: JSON.stringify({ questions: [{ title: "Continue?" }] }), internal_chat_message_metadata_passthrough: { turn_id: turnId } } });
  const human = (turnId: string) => ({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "New instructions" }],
    internal_chat_message_metadata_passthrough: { turn_id: turnId } } });
  const accepted = { type: "response_item", payload: { type: "function_call_output", call_id: "shared-call-id", output: '{"accepted":true}' } };
  f.write(file, [f.meta(), f.event("task_started", "old"), request("old"), accepted, f.event("task_complete", "old"),
    f.event("task_started", "new"), human("new"), f.event("task_complete", "new")]);
  f.write(other, [f.meta("other"), f.event("task_started", "other-turn"), request("other-turn"), accepted]);
  try {
    await f.monitor.start();
    assert.equal(last("session-old")?.attention, undefined);
    assert.equal(last("other")?.attention?.count, 1);
    assert.equal(f.notifications.length, 0);
    f.append(file, [f.event("task_started", "live"), human("live"), request("live"), accepted]);
    await f.tick();
    assert.equal(last("session-old")?.attention?.count, 1);
    f.append(file, [f.event("task_started", "next")]);
    await f.tick();
    assert.equal(last("session-old")?.attention?.count, 1);
    f.append(file, [human("next")]);
    await f.tick();
    assert.equal(last("session-old")?.attention, undefined);
    assert.equal(last("other")?.attention?.count, 1);
  } finally { f.monitor.dispose(); }
});

test("Claude monitor suppresses premature notifications and notifies once for the final human task", async () => {
  const f = fixture("claude");
  const file = `${f.root}/project/session.jsonl`;
  const row = (type: string, uuid: string, content: unknown, extra = {}) => ({ type, uuid, sessionId: "session", cwd: `${f.home}/opticaldna_pixel`,
    timestamp: new Date(f.now()).toISOString(), message: { content }, ...extra });
  const end = (uuid: string) => row("assistant", uuid, [{ type: "text", text: "Report" }], { message: { stop_reason: "end_turn" } });
  f.write(file, [row("user", "historical", "Earlier task"), end("old-end")]);
  try {
    await f.monitor.start();
    assert.equal(f.notifications.length, 0);
    f.append(file, [row("user", "human", "Build figures"),
      row("assistant", "launch", [{ type: "tool_use", id: "tool", name: "Agent", input: { run_in_background: "true" } }]),
      row("user", "launched", [{ type: "tool_result", tool_use_id: "tool", content: "launched" }], { toolUseResult: { isAsync: true, status: "async_launched", agentId: "agent" } }),
      end("waiting")]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.status, "running");
    assert.equal(f.notifications.length, 0);
    f.append(file, [row("user", "notice", "<task-notification><task-id>agent</task-id><status>completed</status></task-notification>")]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.turnId, "human");
    assert.equal(f.notifications.length, 0);
    f.append(file, [end("final-thinking"), end("final-text")]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.status, "completed");
    assert.equal(f.activities.at(-1)?.title, "Build figures");
    assert.equal(f.notifications.length, 1);
    await f.tick();
    assert.equal(f.notifications.length, 1);
  } finally { f.monitor.dispose(); }
});

test("mounted remote home and resumed old-date logs are monitored by modification time", async () => {
  const f = fixture();
  const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
  const cold = `${f.root}/2026/09/12/rollout-cold.jsonl`;
  f.write(old, [f.meta(), f.event("task_started"), f.event("task_complete")]);
  f.write(cold, [f.meta("cold")], f.now() - 8 * 86_400_000);
  try {
    await f.monitor.start();
    const diagnostics = f.monitor.getDiagnostics();
    assert.ok(diagnostics.sessionsRoots.includes(`vscode-remote://${f.authority}${f.root}`));
    assert.equal(diagnostics.trackedFileCount, 1);
    assert.deepEqual(f.reads, [old]); // Inactive history is inspected only through metadata.
    assert.equal(f.activities.at(-1)?.status, "completed");
    assert.equal(f.activities.at(-1)?.live, false);
    assert.equal(f.notifications.length, 0);

    f.append(old, [f.event("task_started", "new-turn"), f.event("user_message", "new-turn", { message: "继续当前项目" })]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.status, "running");
    assert.equal(f.activities.at(-1)?.turnId, "new-turn");
    assert.equal(f.activities.at(-1)?.title, "继续当前项目");
    assert.equal(f.activities.at(-1)?.live, true);

    f.append(old, [f.event("task_complete", "new-turn")]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.status, "completed");
    assert.equal(f.notifications.length, 1);
    await f.tick();
    assert.equal(f.notifications.length, 1);
  } finally { f.monitor.dispose(); }
});

test("a previously inactive log resumes without replaying historical completions as new reminders", async () => {
  const f = fixture();
  const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
  f.write(old, [f.meta(), f.event("task_started"), f.event("user_message", "turn-old", { message: "旧消息含中文 🧬" }),
    f.event("task_complete")], f.now() - 8 * 86_400_000, "\r\n");
  try {
    await f.monitor.start();
    assert.equal(f.monitor.getDiagnostics().trackedFileCount, 0);
    assert.equal(f.reads.length, 0);
    f.append(old, [f.event("task_started", "new-turn"), f.event("user_message", "new-turn", { message: "新的运行轮次" })], "\r\n");
    await f.tick();
    assert.equal(f.activities.at(-1)?.status, "running");
    assert.equal(f.activities.at(-1)?.turnId, "new-turn");
    assert.equal(f.notifications.length, 0);
    assert.ok(f.activities.filter((activity) => activity.turnId === "turn-old").every((activity) => !activity.live));
    f.append(old, [f.event("task_complete", "new-turn")], "\r\n");
    await f.tick();
    assert.equal(f.notifications.length, 1);
    assert.equal(f.activities.at(-1)?.turnId, "new-turn");
    assert.equal(f.activities.at(-1)?.status, "completed");
  } finally { f.monitor.dispose(); }
});

test("unfinished history stays hidden until new activity is observed in the old conversation", async () => {
  const f = fixture();
  const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
  f.write(old, [f.meta(), f.event("task_started"), f.event("user_message", "turn-old", { message: "原来的问题" })]);
  try {
    await f.monitor.start();
    assert.equal(f.activities.at(-1)?.status, "unknown");
    assert.equal(f.activities.at(-1)?.live, false);
    f.append(old, [{ type: "response_item", payload: { type: "reasoning" } }]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.status, "running");
    assert.equal(f.activities.at(-1)?.live, true);
    assert.equal(f.notifications.length, 0);
  } finally { f.monitor.dispose(); }
});

test("a shortened replacement log does not reuse an inactive file's historical byte boundary", async () => {
  const f = fixture();
  const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
  f.write(old, [f.meta(), f.event("task_started"), f.event("user_message", "turn-old", { message: "x".repeat(2000) }),
    f.event("task_complete")], f.now() - 8 * 86_400_000);
  try {
    await f.monitor.start();
    f.write(old, [f.meta("replacement"), f.event("task_started", "replacement-turn")]);
    await f.tick();
    assert.equal(f.activities.at(-1)?.sessionId, "replacement");
    assert.equal(f.activities.at(-1)?.turnId, "replacement-turn");
    assert.equal(f.activities.at(-1)?.status, "running");
    assert.equal(f.notifications.length, 0);
  } finally { f.monitor.dispose(); }
});
