"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const node_module_1 = require("node:module");
const path = __importStar(require("node:path"));
const vm = __importStar(require("node:vm"));
const node_test_1 = __importDefault(require("node:test"));
/** Run the production monitor against a remote filesystem, without a live VS Code host. */
function fixture() {
    const home = "/data/home/mapengsen";
    const workspace = `${home}/opticaldna_pixel`;
    const root = `${home}/.codex/sessions`;
    const authority = "ssh-remote+server";
    let clock = Date.now();
    class Uri {
        path;
        scheme;
        authority;
        constructor(path, scheme = "vscode-remote", authority = "ssh-remote+server") {
            this.path = path;
            this.scheme = scheme;
            this.authority = authority;
        }
        with(value) { return new Uri(value.path, this.scheme, this.authority); }
        toString() { return `${this.scheme}://${this.authority}${this.path}`; }
        static joinPath(base, ...segments) { return base.with({ path: path.posix.join(base.path, ...segments) }); }
        static file(value) { return new Uri(value, "file", ""); }
    }
    const nodes = new Map();
    const directory = (name) => {
        if (nodes.has(name))
            return;
        nodes.set(name, { type: 2, text: "", mtime: clock });
        if (name !== "/")
            directory(path.posix.dirname(name));
    };
    directory(root);
    directory(workspace);
    const reads = [];
    const activities = [];
    const notifications = [];
    const api = { Uri, FileType: { File: 1, Directory: 2 },
        workspace: { workspaceFolders: [{ uri: new Uri(workspace) }], getConfiguration: () => ({ get: (_, fallback) => fallback }),
            fs: {
                readDirectory: async (uri) => {
                    if (uri.scheme !== "vscode-remote" || !nodes.has(uri.path))
                        throw new Error("Missing directory");
                    return [...nodes].filter(([name]) => name !== uri.path && path.posix.dirname(name) === uri.path)
                        .map(([name, node]) => [path.posix.basename(name), node.type]);
                },
                stat: async (uri) => {
                    const node = uri.scheme === "vscode-remote" && nodes.get(uri.path);
                    if (!node)
                        throw new Error("Missing file");
                    return { type: node.type, size: Buffer.byteLength(node.text), mtime: node.mtime };
                },
                readFile: async (uri) => {
                    const node = nodes.get(uri.path);
                    strict_1.default.ok(node);
                    reads.push(uri.path);
                    return Buffer.from(node.text);
                },
            },
        },
    };
    const file = path.resolve(__dirname, "../sessionMonitor.js");
    const localRequire = (0, node_module_1.createRequire)(file);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { exports: module.exports, module, Buffer, console,
        Date: { now: () => clock }, process: { env: {} }, setInterval: () => 1, clearInterval() { },
        require: (name) => name === "vscode" ? api : name === "./notify" ? {
            notifyDesktop: async (title) => { notifications.push(title); return { delivered: true, outcome: "delivered" }; },
        } : localRequire(name),
    });
    const monitor = new module.exports.CodexSessionMonitor((activity) => activities.push(activity));
    const event = (type, turnId = "turn-old", extra = {}) => ({ type: "event_msg", timestamp: new Date(clock).toISOString(),
        payload: { type, turn_id: turnId, ...extra } });
    const meta = (id = "session-old") => ({ type: "session_meta", payload: { id, cwd: workspace, source: "vscode" } });
    const write = (name, records, mtime = clock, newline = "\n") => {
        directory(path.posix.dirname(name));
        nodes.set(name, { type: 1, text: records.map((record) => JSON.stringify(record)).join(newline) + newline, mtime });
    };
    const append = (name, records, newline = "\n") => {
        const node = nodes.get(name);
        node.text += records.map((record) => JSON.stringify(record)).join(newline) + newline;
        node.mtime = ++clock;
    };
    return { root, home, authority, reads, activities, notifications, monitor, event, meta, write, append,
        now: () => clock, tick: () => monitor.poll(true) };
}
(0, node_test_1.default)("mounted remote home and resumed old-date logs are monitored by modification time", async () => {
    const f = fixture();
    const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
    const cold = `${f.root}/2026/09/12/rollout-cold.jsonl`;
    f.write(old, [f.meta(), f.event("task_started"), f.event("task_complete")]);
    f.write(cold, [f.meta("cold")], f.now() - 8 * 86_400_000);
    try {
        await f.monitor.start();
        const diagnostics = f.monitor.getDiagnostics();
        strict_1.default.ok(diagnostics.sessionsRoots.includes(`vscode-remote://${f.authority}${f.root}`));
        strict_1.default.equal(diagnostics.trackedFileCount, 1);
        strict_1.default.deepEqual(f.reads, [old]); // Inactive history is inspected only through metadata.
        strict_1.default.equal(f.activities.at(-1)?.status, "completed");
        strict_1.default.equal(f.activities.at(-1)?.live, false);
        strict_1.default.equal(f.notifications.length, 0);
        f.append(old, [f.event("task_started", "new-turn"), f.event("user_message", "new-turn", { message: "继续当前项目" })]);
        await f.tick();
        strict_1.default.equal(f.activities.at(-1)?.status, "running");
        strict_1.default.equal(f.activities.at(-1)?.turnId, "new-turn");
        strict_1.default.equal(f.activities.at(-1)?.title, "继续当前项目");
        strict_1.default.equal(f.activities.at(-1)?.live, true);
        f.append(old, [f.event("task_complete", "new-turn")]);
        await f.tick();
        strict_1.default.equal(f.activities.at(-1)?.status, "completed");
        strict_1.default.equal(f.notifications.length, 1);
        await f.tick();
        strict_1.default.equal(f.notifications.length, 1);
    }
    finally {
        f.monitor.dispose();
    }
});
(0, node_test_1.default)("a previously inactive log resumes without replaying historical completions as new reminders", async () => {
    const f = fixture();
    const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
    f.write(old, [f.meta(), f.event("task_started"), f.event("user_message", "turn-old", { message: "旧消息含中文 🧬" }),
        f.event("task_complete")], f.now() - 8 * 86_400_000, "\r\n");
    try {
        await f.monitor.start();
        strict_1.default.equal(f.monitor.getDiagnostics().trackedFileCount, 0);
        strict_1.default.equal(f.reads.length, 0);
        f.append(old, [f.event("task_started", "new-turn"), f.event("user_message", "new-turn", { message: "新的运行轮次" })], "\r\n");
        await f.tick();
        strict_1.default.equal(f.activities.at(-1)?.status, "running");
        strict_1.default.equal(f.activities.at(-1)?.turnId, "new-turn");
        strict_1.default.equal(f.notifications.length, 0);
        strict_1.default.ok(f.activities.filter((activity) => activity.turnId === "turn-old").every((activity) => !activity.live));
        f.append(old, [f.event("task_complete", "new-turn")], "\r\n");
        await f.tick();
        strict_1.default.equal(f.notifications.length, 1);
        strict_1.default.equal(f.activities.at(-1)?.turnId, "new-turn");
        strict_1.default.equal(f.activities.at(-1)?.status, "completed");
    }
    finally {
        f.monitor.dispose();
    }
});
(0, node_test_1.default)("unfinished history stays hidden until new activity is observed in the old conversation", async () => {
    const f = fixture();
    const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
    f.write(old, [f.meta(), f.event("task_started"), f.event("user_message", "turn-old", { message: "原来的问题" })]);
    try {
        await f.monitor.start();
        strict_1.default.equal(f.activities.at(-1)?.status, "unknown");
        strict_1.default.equal(f.activities.at(-1)?.live, false);
        f.append(old, [{ type: "response_item", payload: { type: "reasoning" } }]);
        await f.tick();
        strict_1.default.equal(f.activities.at(-1)?.status, "running");
        strict_1.default.equal(f.activities.at(-1)?.live, true);
        strict_1.default.equal(f.notifications.length, 0);
    }
    finally {
        f.monitor.dispose();
    }
});
(0, node_test_1.default)("a shortened replacement log does not reuse an inactive file's historical byte boundary", async () => {
    const f = fixture();
    const old = `${f.root}/2026/09/17/rollout-old.jsonl`;
    f.write(old, [f.meta(), f.event("task_started"), f.event("user_message", "turn-old", { message: "x".repeat(2000) }),
        f.event("task_complete")], f.now() - 8 * 86_400_000);
    try {
        await f.monitor.start();
        f.write(old, [f.meta("replacement"), f.event("task_started", "replacement-turn")]);
        await f.tick();
        strict_1.default.equal(f.activities.at(-1)?.sessionId, "replacement");
        strict_1.default.equal(f.activities.at(-1)?.turnId, "replacement-turn");
        strict_1.default.equal(f.activities.at(-1)?.status, "running");
        strict_1.default.equal(f.notifications.length, 0);
    }
    finally {
        f.monitor.dispose();
    }
});
