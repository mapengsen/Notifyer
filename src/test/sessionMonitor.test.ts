import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import * as vm from "node:vm";
import test from "node:test";
import { SessionActivity } from "../sessionActivity";

/** Run the production monitor against a remote filesystem, without a live VS Code host. */
function fixture() {
  const home = "/data/home/mapengsen";
  const workspace = `${home}/opticaldna_pixel`;
  const root = `${home}/.codex/sessions`;
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
  const file = path.resolve(__dirname, "../sessionMonitor.js");
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { exports: module.exports, module, Buffer, console,
    Date: { now: () => clock }, process: { env: {} }, setInterval: () => 1, clearInterval() {},
    require: (name: string) => name === "vscode" ? api : name === "./notify" ? {
      notifyDesktop: async (title: string) => { notifications.push(title); return { delivered: true, outcome: "delivered" }; },
    } : localRequire(name),
  });
  const monitor = new (module.exports as any).CodexSessionMonitor((activity: SessionActivity) => activities.push(activity));
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
