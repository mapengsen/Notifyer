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
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const sessionActivity_1 = require("../sessionActivity");
const displayTitle_1 = require("../displayTitle");
const floatingState_1 = require("../floatingState");
const now = 1_800_000_000_000;
const titleCases = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../scripts/title-cases.json"), "utf8"));
for (const fixture of titleCases) {
    (0, node_test_1.default)(`attachment title: ${fixture.name}`, () => strict_1.default.equal((0, displayTitle_1.cleanSessionTitle)(fixture.input), fixture.expected));
}
(0, node_test_1.default)("multimodal Claude messages keep real text and give attachment-only turns readable titles", () => {
    for (const [content, expected] of [
        [[{ type: "image", source: { type: "base64", data: "private-payload" } }, { type: "text", text: "<pasted_content id='a'>解释图片</pasted_content>" }], "解释图片"],
        [[{ type: "image", source: { type: "base64", data: "private-payload" } }], "图片消息"],
        [[{ type: "document", source: { type: "base64", data: "private-payload" } }], "附件消息"],
    ]) {
        const updates = [];
        const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
        tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content } }, true, now);
        strict_1.default.equal(updates.at(-1)?.title, expected);
        strict_1.default.equal(updates.at(-1)?.status, "running");
    }
});
(0, node_test_1.default)("Codex cleans full prompt text before storing the title and supports image-only turns", () => {
    const { tracker, updates } = codexTracker();
    tracker.consume(event("user_message", { message: titleCases.find((item) => item.name === "clean before truncation").input }), true, now);
    strict_1.default.equal(updates.at(-1)?.title, "真正的用户需求");
    tracker.consume(event("user_message", { turn_id: "turn-2", message: "", images: ["private.png"] }), true, now + 1);
    strict_1.default.equal(updates.at(-1)?.title, "图片消息");
});
(0, node_test_1.default)("panel watchdog treats a hidden panel as healthy and detects stale or missing helpers", () => {
    const heartbeat = { pid: 1234, updatedAt: now, visible: false, version: "0.4.1" };
    strict_1.default.equal((0, floatingState_1.isPanelHealthy)(heartbeat, now), true);
    strict_1.default.equal((0, floatingState_1.isPanelHealthy)({ ...heartbeat, visible: true }, now), true);
    strict_1.default.equal((0, floatingState_1.isPanelHealthy)(undefined, now), false);
    strict_1.default.equal((0, floatingState_1.isPanelHealthy)({ ...heartbeat, updatedAt: now - 16000 }, now), false);
    strict_1.default.equal((0, floatingState_1.isPanelHealthy)({ ...heartbeat, pid: 0 }, now), false);
    strict_1.default.equal((0, floatingState_1.isPanelHealthy)({ ...heartbeat, updatedAt: now + 60000 }, now), false);
});
(0, node_test_1.default)("status bar follows the actual visibility of a healthy helper and treats an absent helper as hidden", () => {
    const heartbeat = { pid: 1234, updatedAt: now, visible: true, version: "0.4.4" };
    strict_1.default.equal((0, floatingState_1.panelVisibility)(heartbeat, undefined, now), true);
    strict_1.default.equal((0, floatingState_1.panelVisibility)({ ...heartbeat, visible: false }, undefined, now), false);
    strict_1.default.equal((0, floatingState_1.panelVisibility)({ ...heartbeat, updatedAt: now - 20000 }, undefined, now), false);
    strict_1.default.equal((0, floatingState_1.panelVisibility)(undefined, undefined, now), false);
});
(0, node_test_1.default)("show and hide clicks update state before the native polling loop consumes them", () => {
    const heartbeat = { pid: 1234, updatedAt: now, visible: false, version: "0.4.4", controlId: "old" };
    const show = { type: "show", id: "show", requestedAt: now };
    strict_1.default.equal((0, floatingState_1.panelVisibility)(heartbeat, show, now), true);
    strict_1.default.equal((0, floatingState_1.panelVisibility)(undefined, show, now), true);
    strict_1.default.equal((0, floatingState_1.panelVisibility)({ ...heartbeat, visible: true }, { ...show, type: "hide", id: "hide" }, now), false);
});
(0, node_test_1.default)("native acknowledgement allows the close button to override a recently handled show request", () => {
    const heartbeat = { pid: 1234, updatedAt: now, visible: false, version: "0.4.4", controlId: "show" };
    strict_1.default.equal((0, floatingState_1.panelVisibility)(heartbeat, { type: "show", id: "show", requestedAt: now }, now), false);
});
(0, node_test_1.default)("an expired or future show request cannot leave the status bar stuck in the visible state", () => {
    strict_1.default.equal((0, floatingState_1.panelVisibility)(undefined, { type: "show", id: "old", requestedAt: now - 11000 }, now), false);
    strict_1.default.equal((0, floatingState_1.panelVisibility)(undefined, { type: "show", id: "future", requestedAt: now + 60000 }, now), false);
});
(0, node_test_1.default)("rapid alternating clicks from different windows share the last requested state", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-visibility-"));
    try {
        const file = path.join(folder, "control.json");
        for (const [index, type] of ["show", "hide", "show", "hide"].entries()) {
            (0, floatingState_1.atomicWriteJson)(file, { type, id: String(index), requestedAt: now });
            const readFromFirstWindow = JSON.parse(fs.readFileSync(file, "utf8"));
            const readFromSecondWindow = JSON.parse(fs.readFileSync(file, "utf8"));
            strict_1.default.equal((0, floatingState_1.panelVisibility)(undefined, readFromFirstWindow, now), type === "show");
            strict_1.default.equal((0, floatingState_1.panelVisibility)(undefined, readFromSecondWindow, now), type === "show");
        }
    }
    finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
function activity(overrides = {}) {
    return { key: "codex:local:session", provider: "codex", sessionId: "session", turnId: "turn-1",
        cwd: "C:/project", title: "Fix login", status: "running", startedAt: now - 1000, updatedAt: now, live: true, ...overrides };
}
function snapshot(windowId, session, overrides = {}) {
    return { version: 1, windowId, workspace: "file:///C:/project", project: "Project", environment: "本地",
        windowHandle: "1", pid: 123, heartbeat: now, sessions: [session], ...overrides };
}
function codexTracker() {
    const updates = [];
    const removed = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("codex", "local", (item, remove) => remove ? removed.push(item.key) : updates.push(item));
    tracker.consume({ type: "session_meta", payload: { id: "session", cwd: "C:/project" } }, false, now);
    return { tracker, updates, removed };
}
const event = (type, payload = {}) => ({
    type: "event_msg", timestamp: new Date(now).toISOString(), payload: { type, turn_id: "turn-1", ...payload },
});
(0, node_test_1.default)("Codex running -> complete uses the same turn and retains its human title", () => {
    const { tracker, updates } = codexTracker();
    tracker.consume(event("task_started"), true, now);
    tracker.consume(event("user_message", { message: "修复登录问题" }), true, now + 1);
    tracker.consume(event("agent_message", { message: "正在运行测试" }), true, now + 2);
    strict_1.default.equal(updates.at(-1)?.status, "running");
    tracker.consume(event("task_complete"), true, now + 3);
    strict_1.default.equal(updates.at(-1)?.status, "completed");
    strict_1.default.equal(updates.at(-1)?.title, "修复登录问题");
    strict_1.default.equal(updates.at(-1)?.turnId, "turn-1");
});
(0, node_test_1.default)("Codex terminal time stays fixed through later bookkeeping and question replies", () => {
    const { tracker, updates } = codexTracker();
    tracker.consume(event("task_started"), true, now);
    tracker.consume(event("task_complete"), true, now + 125000);
    strict_1.default.equal(updates.at(-1)?.finishedAt, now + 125000);
    tracker.consume(event("token_count"), true, now + 3600000);
    tracker.consume({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<send_user_message_question_reply>[]</send_user_message_question_reply>" }] } }, true, now + 7200000);
    strict_1.default.equal(updates.at(-1)?.finishedAt, now + 125000);
    strict_1.default.equal(updates.at(-1)?.startedAt, now);
    tracker.consume(event("task_started", { turn_id: "next" }), true, now + 8000000);
    strict_1.default.equal(updates.at(-1)?.finishedAt, undefined);
    strict_1.default.equal(updates.at(-1)?.startedAt, now + 8000000);
});
(0, node_test_1.default)("Claude completion duration freezes and a new human turn gets a fresh timer", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", uuid: "human", sessionId: "session", cwd: "/work", message: { content: "Task" } }, true, now);
    tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 300000);
    tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 3600000);
    strict_1.default.equal(updates.at(-1)?.finishedAt, now + 300000);
    tracker.consume({ type: "user", uuid: "next", message: { content: "Next task" } }, true, now + 7200000);
    strict_1.default.equal(updates.at(-1)?.finishedAt, undefined);
    strict_1.default.equal(updates.at(-1)?.startedAt, now + 7200000);
});
(0, node_test_1.default)("stored legacy completions retain their first endpoint and accept corrected replay timestamps", () => {
    const completed = activity({ status: "completed", startedAt: now, updatedAt: now + 480000 });
    const stored = (0, floatingState_1.applyActivity)(undefined, completed);
    strict_1.default.equal(stored.finishedAt, now + 480000);
    const refreshed = (0, floatingState_1.applyActivity)(stored, { ...completed, updatedAt: now + 3600000 });
    strict_1.default.equal(refreshed.finishedAt, now + 480000);
    const corrected = (0, floatingState_1.applyActivity)(refreshed, { ...completed, finishedAt: now + 420000, updatedAt: now + 7200000 });
    strict_1.default.equal(corrected.finishedAt, now + 420000);
    strict_1.default.equal((0, floatingState_1.applyActivity)(corrected, { ...completed, status: "running", turnId: "new", updatedAt: now + 8000000 }).finishedAt, undefined);
});
(0, node_test_1.default)("child identity survives inherited parent metadata, and late child classification retracts a row", () => {
    const { tracker, updates, removed } = codexTracker();
    tracker.consume(event("task_started"), true, now);
    tracker.consume({ type: "session_meta", payload: { id: "child", source: "subagent" } }, true, now);
    tracker.consume({ type: "session_meta", payload: { id: "parent", cwd: "C:/project" } }, true, now);
    tracker.consume(event("task_complete"), true, now);
    strict_1.default.equal(updates.length, 1);
    strict_1.default.equal(removed.length, 1);
});
(0, node_test_1.default)("aborted turns are unknown instead of completed or running", () => {
    const { tracker, updates } = codexTracker();
    tracker.consume(event("task_started"), true, now);
    tracker.consume(event("turn_aborted"), true, now + 1);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
    tracker.consume(event("error", { message: "Cancelled stream" }), true, now + 2);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
});
(0, node_test_1.default)("a Codex error does not finish a task before its completion event", () => {
    const { tracker, updates } = codexTracker();
    tracker.consume(event("task_started"), true, now);
    tracker.consume(event("error", { message: "failed" }), true, now + 1);
    strict_1.default.equal(updates.at(-1)?.status, "running");
    tracker.consume(event("task_complete"), true, now + 2);
    strict_1.default.equal(updates.at(-1)?.status, "failed");
    tracker.consume(event("task_started", { turn_id: "turn-2" }), true, now + 3);
    tracker.consume(event("task_complete", { turn_id: "turn-2" }), true, now + 4);
    strict_1.default.equal(updates.at(-1)?.status, "completed");
});
(0, node_test_1.default)("historical baseline does not produce unread results; live completions do", () => {
    strict_1.default.equal((0, floatingState_1.applyActivity)(undefined, activity({ status: "completed", live: false })).unread, false);
    strict_1.default.equal((0, floatingState_1.applyActivity)(undefined, activity({ status: "completed" })).unread, true);
});
(0, node_test_1.default)("baseline replay after reload preserves a persisted unread completion", () => {
    const previous = (0, floatingState_1.applyActivity)(undefined, activity({ status: "completed" }));
    strict_1.default.equal((0, floatingState_1.applyActivity)(previous, activity({ status: "completed", live: false })).unread, true);
    strict_1.default.deepEqual((0, floatingState_1.applyActivity)(previous, activity({ updatedAt: now - 5000, live: false })), previous);
});
(0, node_test_1.default)("Claude tool results and intermediate assistant messages do not finish or replace the human turn", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "remote-host-a", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work/project", uuid: "human-1",
        message: { content: "训练模型" } }, true, now);
    tracker.consume({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", name: "Bash" }] } }, true, now + 1);
    tracker.consume({ type: "user", uuid: "tool-2", message: { content: [{ type: "tool_result", content: "ok" }] } }, true, now + 2);
    strict_1.default.equal(updates.at(-1)?.turnId, "human-1");
    strict_1.default.equal(updates.at(-1)?.status, "running");
    tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 3);
    strict_1.default.equal(updates.at(-1)?.status, "completed");
    strict_1.default.equal(updates.at(-1)?.title, "训练模型");
});
(0, node_test_1.default)("Claude subagents never enter the panel", () => {
    let count = 0;
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", () => count++);
    tracker.consume({ type: "user", sessionId: "child", isSidechain: true, uuid: "human",
        message: { content: "subtask" } }, true, now);
    tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now);
    strict_1.default.equal(count, 0);
});
(0, node_test_1.default)("Claude's local /fast transcript does not start a model turn or unread result", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "remote", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "caveat", isMeta: true,
        message: { content: "<local-command-caveat>The command below was run directly in Claude Code.</local-command-caveat>" } }, true, now);
    tracker.consume({ type: "user", uuid: "fast", parentUuid: "caveat",
        message: { content: "<command-name>/fast</command-name>\n<command-message>fast</command-message>\n<command-args></command-args>" } }, true, now + 1);
    tracker.consume({ type: "system", subtype: "local_command", parentUuid: "fast" }, true, now + 2);
    tracker.flushBaseline(now + 3);
    strict_1.default.equal(updates.length, 0);
});
(0, node_test_1.default)("local command metadata and output preserve an active task and a pending completed result", () => {
    for (const completed of [false, true]) {
        const updates = [];
        const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
        tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Real task" } }, true, now);
        if (completed)
            tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 1);
        const before = (0, floatingState_1.applyActivity)(undefined, updates.at(-1));
        const count = updates.length;
        tracker.consume({ type: "user", uuid: "local-caveat", isMeta: true,
            message: { content: "<local-command-caveat>Local settings command</local-command-caveat>" } }, true, now + 2);
        tracker.consume({ type: "user", uuid: "control", parentUuid: "local-caveat",
            message: { content: [{ type: "text", text: "<command-name>/settings-control</command-name>" }] } }, true, now + 3);
        tracker.consume({ type: "user", uuid: "output", message: { content: "<local-command-stdout>Settings changed</local-command-stdout>" } }, true, now + 4);
        tracker.consume({ type: "system", subtype: "local_command", parentUuid: "control" }, true, now + 5);
        strict_1.default.equal(updates.length, count);
        strict_1.default.deepEqual((0, floatingState_1.applyActivity)(before, updates.at(-1)), before);
        strict_1.default.equal(before.unread, completed);
    }
});
(0, node_test_1.default)("metadata cannot invent a turn, while model-backed slash commands still run and complete", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "metadata", isMeta: true,
        message: { content: "Additional context" } }, true, now);
    strict_1.default.equal(updates.length, 0);
    tracker.consume({ type: "user", uuid: "review", message: { content: "<command-name>/review</command-name> <command-args>Check changes</command-args>" } }, true, now + 1);
    tracker.consume({ type: "user", uuid: "expanded", isMeta: true, message: { content: "Expanded review instructions" } }, true, now + 2);
    tracker.consume({ type: "assistant", message: { stop_reason: "tool_use" } }, true, now + 3);
    strict_1.default.equal(updates.at(-1)?.status, "running");
    strict_1.default.equal(updates.at(-1)?.turnId, "review");
    tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 4);
    strict_1.default.equal(updates.at(-1)?.status, "completed");
    strict_1.default.equal((0, floatingState_1.applyActivity)(undefined, updates.at(-1)).unread, true);
});
(0, node_test_1.default)("an unmarked local-command result retracts only its own turn", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "local", message: { content: "<command-name>/settings-control</command-name>" } }, true, now);
    tracker.consume({ type: "system", subtype: "local_command", parentUuid: "local" }, true, now + 1);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
    strict_1.default.equal((0, floatingState_1.applyActivity)(undefined, updates.at(-1)).unread, false);
    tracker.consume({ type: "user", uuid: "human", message: { content: "Explain how /fast works" } }, true, now + 2);
    const count = updates.length;
    tracker.consume({ type: "system", subtype: "local_command", parentUuid: "local" }, true, now + 3);
    strict_1.default.equal(updates.length, count);
    strict_1.default.equal(updates.at(-1)?.status, "running");
    strict_1.default.equal(updates.at(-1)?.turnId, "human");
});
(0, node_test_1.default)("cached Claude control rows disappear without hiding model-backed commands or Codex", () => {
    for (const title of ["<command-name>/fast</command-name> <command-message>fast</command-message>",
        "<local-command-caveat>Local command only</local-command-caveat>", "<local-command-stdout>Fast mode unavailable</local-command-stdout>"]) {
        const legacy = (0, floatingState_1.applyActivity)(undefined, activity({ provider: "claude", title }));
        const real = (0, floatingState_1.applyActivity)(undefined, activity({ key: "claude:local:real", provider: "claude", title: "Real task", status: "completed" }));
        const rows = (0, floatingState_1.aggregateSessions)([snapshot("window", legacy), snapshot("window", real)], () => false, now);
        strict_1.default.deepEqual(rows.map((row) => row.key), [real.key]);
        strict_1.default.equal(rows[0].unread, true);
    }
    for (const title of ["<command-name>/review</command-name>", "Explain how /fast works"]) {
        const item = (0, floatingState_1.applyActivity)(undefined, activity({ provider: "claude", title }));
        strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("window", item)], () => false, now)[0].status, "running");
    }
    const codex = (0, floatingState_1.applyActivity)(undefined, activity({ title: "<command-name>/fast</command-name>" }));
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("window", codex)], () => false, now)[0].status, "running");
});
(0, node_test_1.default)("historical unfinished turns stay hidden until actual live activity resumes", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human",
        timestamp: new Date(now - 60000).toISOString(), message: { content: "Continue the work" } }, false, now);
    strict_1.default.equal(updates.length, 0);
    tracker.flushBaseline(now);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
    strict_1.default.equal(updates.at(-1)?.live, false);
    tracker.consume({ type: "assistant", message: { stop_reason: "tool_use" } }, true, now + 1);
    strict_1.default.equal(updates.at(-1)?.status, "running");
    strict_1.default.equal(updates.at(-1)?.live, true);
});
(0, node_test_1.default)("baseline replay reconciles an old completion over a more recent cached running observation", () => {
    const cached = (0, floatingState_1.applyActivity)(undefined, activity({ provider: "claude", turnId: "human", updatedAt: now - 1000 }));
    let stored = cached;
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => { stored = (0, floatingState_1.applyActivity)(stored, item); });
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human",
        timestamp: new Date(now - 5 * 3600000).toISOString(), message: { content: "Resume" } }, false, now);
    tracker.consume({ type: "assistant", timestamp: new Date(now - 4 * 3600000).toISOString(),
        message: { stop_reason: "end_turn" } }, false, now);
    tracker.flushBaseline(now);
    strict_1.default.equal(stored.status, "completed");
    strict_1.default.equal(stored.unread, false);
    strict_1.default.equal(stored.updatedAt, now - 4 * 3600000);
    strict_1.default.equal(stored.observedAt, now);
});
(0, node_test_1.default)("replaying a whole historical file preserves an existing unread final result without emitting earlier turns", () => {
    let stored = (0, floatingState_1.applyActivity)(undefined, activity({ provider: "claude", turnId: "latest", status: "completed", updatedAt: now - 1 }));
    let emitted = 0;
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => { emitted++; stored = (0, floatingState_1.applyActivity)(stored, item); });
    for (const turn of ["earlier", "latest"]) {
        tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: turn,
            timestamp: new Date(now - 60000).toISOString(), message: { content: "Task" } }, false, now);
        tracker.consume({ type: "assistant", timestamp: new Date(now - 30000).toISOString(),
            message: { stop_reason: "end_turn" } }, false, now);
    }
    tracker.flushBaseline(now);
    strict_1.default.equal(emitted, 1);
    strict_1.default.equal(stored.turnId, "latest");
    strict_1.default.equal(stored.unread, true);
});
(0, node_test_1.default)("a reconciled final state wins across windows without making old log activity fresh", () => {
    const cached = (0, floatingState_1.applyActivity)(undefined, activity({ updatedAt: now - 1000 }));
    const reconciled = (0, floatingState_1.applyActivity)(undefined, activity({ status: "completed", live: false,
        updatedAt: now - 4 * 3600000, observedAt: now }));
    const rows = (0, floatingState_1.aggregateSessions)([snapshot("old", cached), snapshot("new", reconciled)], () => false, now);
    strict_1.default.equal(rows[0].status, "completed");
    strict_1.default.equal(rows[0].unread, false);
    const quiet = { ...reconciled, status: "running", live: true };
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("new", quiet)], () => false, now)[0].status, "unknown");
});
(0, node_test_1.default)("legacy baseline-only running rows never count as live work even below 500 minutes", () => {
    const item = (0, floatingState_1.applyActivity)(undefined, activity({ live: false, startedAt: now - 1000, updatedAt: now }));
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("a", item)], () => false, now)[0].status, "unknown");
});
(0, node_test_1.default)("Claude interruption markers stop the current turn rather than starting a phantom user turn", () => {
    for (const marker of ["[Request interrupted by user]", "[Request interrupted by user for tool use]"]) {
        const updates = [];
        const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
        tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Real task" } }, true, now);
        tracker.consume({ type: "user", uuid: "marker", message: { content: marker } }, true, now + 1);
        strict_1.default.equal(updates.at(-1)?.status, "unknown");
        strict_1.default.equal(updates.at(-1)?.turnId, "human");
        strict_1.default.equal(updates.at(-1)?.title, "Real task");
        strict_1.default.equal((0, floatingState_1.applyActivity)(undefined, updates.at(-1)).unread, false);
    }
});
(0, node_test_1.default)("Claude API disconnects hide running work, bookkeeping cannot revive it, and actual assistant activity can", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Train" } }, true, now);
    tracker.consume({ type: "system", subtype: "api_error", retryAttempt: 1, maxRetries: 10, error: { message: "Connection error." } }, true, now + 1);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
    tracker.consume({ type: "progress", data: { type: "hook_progress" } }, true, now + 2);
    tracker.consume({ type: "last-prompt", sessionId: "session" }, true, now + 3);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
    tracker.consume({ type: "assistant", message: { stop_reason: "tool_use" } }, true, now + 4);
    strict_1.default.equal(updates.at(-1)?.status, "running");
    tracker.consume({ type: "assistant", message: { stop_reason: "end_turn" } }, true, now + 5);
    strict_1.default.equal(updates.at(-1)?.status, "completed");
});
(0, node_test_1.default)("Claude synthetic API errors and truncated responses do not create unread completions", () => {
    for (const terminal of [
        { type: "assistant", isApiErrorMessage: true, message: { stop_reason: "end_turn" } },
        { type: "assistant", message: { stop_reason: "max_tokens" } },
    ]) {
        const updates = [];
        const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
        tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human", message: { content: "Task" } }, true, now);
        tracker.consume(terminal, true, now + 1);
        strict_1.default.equal(updates.at(-1)?.status, "unknown");
        strict_1.default.equal((0, floatingState_1.applyActivity)(undefined, updates.at(-1)).unread, false);
    }
});
(0, node_test_1.default)("resume wording in a genuine prompt is not a reason to hide an active turn", () => {
    const updates = [];
    const tracker = new sessionActivity_1.SessionActivityTracker("claude", "local", (item) => updates.push(item));
    tracker.consume({ type: "user", sessionId: "session", cwd: "/work", uuid: "human",
        message: { content: "Your response above was cut off mid-stream. Resume directly." } }, true, now);
    strict_1.default.equal(updates.at(-1)?.status, "running");
});
(0, node_test_1.default)("Codex historical replay publishes only its final state and resumes on live logs", () => {
    const { tracker, updates } = codexTracker();
    tracker.consume(event("task_started"), false, now);
    tracker.consume(event("user_message", { message: "Task" }), false, now);
    strict_1.default.equal(updates.length, 0);
    tracker.flushBaseline(now);
    strict_1.default.equal(updates.at(-1)?.status, "unknown");
    tracker.consume(event("agent_message"), true, now + 1);
    strict_1.default.equal(updates.at(-1)?.status, "running");
});
(0, node_test_1.default)("duplicate observations show one row with all matching windows", () => {
    const item = (0, floatingState_1.applyActivity)(undefined, activity());
    const rows = (0, floatingState_1.aggregateSessions)([snapshot("window-a", item), snapshot("window-b", item)], () => false, now);
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].owners.length, 2);
});
(0, node_test_1.default)("same session ids on different remote hosts stay separate", () => {
    const a = (0, floatingState_1.applyActivity)(undefined, activity({ key: "codex:host-a:session" }));
    const b = (0, floatingState_1.applyActivity)(undefined, activity({ key: "codex:host-b:session" }));
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("a", a), snapshot("b", b)], () => false, now).length, 2);
});
(0, node_test_1.default)("remote window labels retain the project and SSH host without the ssh-remote implementation name", () => {
    const item = (0, floatingState_1.applyActivity)(undefined, activity());
    const row = (0, floatingState_1.aggregateSessions)([snapshot("a", item, { project: "DNAKit [SSH: test]", environment: "ssh-remote" })], () => false, now)[0];
    strict_1.default.equal(row.owners[0].label, "DNAKit [SSH: test]");
});
(0, node_test_1.default)("closed windows, stale heartbeats and quiet tasks become unknown", () => {
    const item = (0, floatingState_1.applyActivity)(undefined, activity());
    for (const overrides of [{ closed: true }, { heartbeat: now - 16000 }]) {
        strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("a", item, overrides)], () => false, now)[0].status, "unknown");
    }
    const quiet = { ...item, updatedAt: now - 31 * 60000 };
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("a", quiet)], () => false, now)[0].status, "unknown");
});
(0, node_test_1.default)("one active observer keeps a shared task running even when another window closes", () => {
    const item = (0, floatingState_1.applyActivity)(undefined, activity());
    const row = (0, floatingState_1.aggregateSessions)([snapshot("a", item, { closed: true }), snapshot("b", item)], () => false, now)[0];
    strict_1.default.equal(row.status, "running");
    strict_1.default.equal(row.owners[0].windowId, "b");
});
(0, node_test_1.default)("read acknowledgements synchronize across windows and apply only to the selected turn", () => {
    const item = (0, floatingState_1.applyActivity)(undefined, activity({ status: "completed" }));
    const readKey = (0, floatingState_1.acknowledgementKey)(item);
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("a", item)], (key) => key === readKey, now)[0].unread, false);
    const next = (0, floatingState_1.applyActivity)(item, activity({ turnId: "turn-2", updatedAt: now + 10, status: "completed" }));
    strict_1.default.equal((0, floatingState_1.aggregateSessions)([snapshot("a", next)], (key) => key === readKey, now + 10)[0].unread, true);
});
(0, node_test_1.default)("unread results survive closed windows and age, and sort before running tasks", () => {
    const unread = (0, floatingState_1.applyActivity)(undefined, activity({ key: "old", status: "completed", updatedAt: now - 3 * 86400000 }));
    const running = (0, floatingState_1.applyActivity)(undefined, activity());
    const rows = (0, floatingState_1.aggregateSessions)([snapshot("a", running), snapshot("b", unread, { closed: true })], () => false, now);
    strict_1.default.equal(rows[0].key, "old");
    strict_1.default.equal(rows[0].unread, true);
    strict_1.default.equal(rows[1].status, "running");
});
(0, node_test_1.default)("24-hour history retention hides reviewed results, never an unfinished long-running task", () => {
    const oldTime = now - 3 * 86400000;
    const reviewed = (0, floatingState_1.applyActivity)(undefined, activity({ key: "reviewed", status: "completed", live: false, updatedAt: oldTime }));
    const unfinished = (0, floatingState_1.applyActivity)(undefined, activity({ key: "unfinished", updatedAt: oldTime }));
    const rows = (0, floatingState_1.aggregateSessions)([snapshot("a", reviewed), snapshot("b", unfinished)], () => false, now);
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0].key, "unfinished");
    strict_1.default.equal(rows[0].status, "unknown");
});
(0, node_test_1.default)("shared snapshot replacement is valid JSON and leaves no temporary files", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-panel-"));
    try {
        const file = path.join(folder, "window.json");
        (0, floatingState_1.atomicWriteJson)(file, { title: "中文标题", version: 1 });
        (0, floatingState_1.atomicWriteJson)(file, { title: "中文标题", version: 2 });
        strict_1.default.equal(JSON.parse(fs.readFileSync(file, "utf8")).version, 2);
        strict_1.default.deepEqual(fs.readdirSync(folder), ["window.json"]);
    }
    finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
