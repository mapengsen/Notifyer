"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionActivityTracker = void 0;
exports.isClaudeLocalCommandTitle = isClaudeLocalCommandTitle;
const core_1 = require("./core");
const displayTitle_1 = require("./displayTitle");
const sessionQuestions_1 = require("./sessionQuestions");
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function string(value) {
    return typeof value === "string" ? value.trim() : "";
}
function messageTitle(message) {
    const content = record(message).content;
    const text = typeof content === "string" ? content : Array.isArray(content)
        ? content.filter((item) => record(item).type === "text").map((item) => string(record(item).text)).join(" ") : "";
    const title = (0, displayTitle_1.cleanSessionTitle)(text);
    if (title || !Array.isArray(content))
        return title;
    const types = content.map((item) => string(record(item).type));
    if (types.some((type) => ["image", "input_image"].includes(type)))
        return "图片消息";
    if (types.some((type) => ["document", "file", "input_file"].includes(type)))
        return "附件消息";
    return "";
}
/** Local transcript output and the known /fast toggle are never model tasks. */
function isClaudeLocalCommandTitle(title) {
    return /^\s*<local-command-(?:caveat|stdout|stderr)(?:\s|>)/i.test(title)
        || /^\s*<command-name>\s*\/fast\s*<\/command-name>(?:\s|$)/i.test(title);
}
/** Tracks turns, rather than treating every assistant/tool message as a completion. */
class SessionActivityTracker {
    provider;
    source;
    emit;
    sessionId = "";
    cwd = "";
    child = false;
    current;
    turnError = false;
    contextTurnId = "";
    localCommandParent;
    observedAt = 0;
    questions = new sessionQuestions_1.SessionQuestions();
    constructor(provider, source, emit) {
        this.provider = provider;
        this.source = source;
        this.emit = emit;
    }
    reset() {
        this.questions.reset();
        if (this.current)
            this.emit({ ...this.current, status: "unknown", attention: undefined, observedAt: Date.now() });
        this.sessionId = "";
        this.cwd = "";
        this.child = false;
        this.current = undefined;
        this.turnError = false;
        this.contextTurnId = "";
        this.localCommandParent = undefined;
    }
    consume(input, live, now = Date.now()) {
        this.observedAt = now;
        const payload = record(input.payload);
        if (this.provider === "codex" && input.type === "session_meta") {
            this.sessionId = string(payload.id) || string(payload.session_id) || this.sessionId;
            this.cwd = string(payload.cwd) || this.cwd;
            this.classifyChild((0, core_1.isChildSessionMeta)(payload));
            return;
        }
        if (this.provider === "claude") {
            this.sessionId = string(input.sessionId) || this.sessionId;
            this.cwd = string(input.cwd) || this.cwd;
            this.classifyChild(input.isSidechain === true || Boolean(input.agentId || input.agent_id));
        }
        if (this.child)
            return;
        const parsedTime = Date.parse(string(input.timestamp));
        // Live observations use this host's clock, including for remote sessions.
        const at = live || !Number.isFinite(parsedTime) ? now : Math.min(parsedTime, now);
        if (this.provider === "codex") {
            if (input.type === "turn_context") {
                this.cwd = string(payload.cwd) || this.cwd;
                this.contextTurnId = string(payload.turn_id) || this.contextTurnId;
                // Context alone is not proof that a task is still running.
                return;
            }
            if (input.type === "response_item") {
                this.questions.consumeCodex(payload, at);
                if (!this.current && this.questions.attention)
                    this.begin(this.contextTurnId || string(payload.call_id) || String(at), at, live);
                if (this.current)
                    this.update(this.current.status, at, live);
                return;
            }
            if (input.type !== "event_msg")
                return;
            const type = string(payload.type);
            const turnId = string(payload.turn_id) || this.contextTurnId || this.current?.turnId || "";
            if (!turnId)
                return;
            if (type === "task_started") {
                this.contextTurnId = turnId;
                this.begin(turnId, at, live);
            }
            if (type === "user_message") {
                this.questions.consumeReplyText(string(payload.message));
                if (!this.current || this.current.turnId !== turnId)
                    this.begin(turnId, at, live);
                if (this.current && !string(payload.message).includes("<send_user_message_question_reply>"))
                    this.current.title = (0, displayTitle_1.cleanSessionTitle)(payload.message)
                        || ([payload.images, payload.local_images].some((images) => Array.isArray(images) && images.length > 0) ? "图片消息" : "");
            }
            if (type === "task_complete") {
                if (!this.current || this.current.turnId !== turnId)
                    this.begin(turnId, at, live);
                this.questions.finishTurn();
                this.update(this.turnError ? "failed" : "completed", at, live);
            }
            else if (type === "turn_aborted" || type === "task_aborted") {
                // Async questions have their own reply/cancellation lifecycle and may
                // belong to an earlier turn. Aborting unrelated work must retain them.
                this.questions.finishTurn();
                this.update("unknown", at, live);
            }
            else if (type === "error") {
                if (this.current?.status === "running") {
                    this.turnError = true;
                    this.update("running", at, live);
                }
            }
            else if (this.current && ["task_started", "user_message", "agent_message", "token_count"].includes(type)) {
                this.update(this.current.status, at, live);
            }
            return;
        }
        const content = record(input.message).content;
        this.questions.consumeClaude(input, at);
        const toolResult = Array.isArray(content) && content.some((item) => record(item).type === "tool_result");
        const title = messageTitle(input.message);
        const stopReason = string(record(input.message).stop_reason);
        if (input.type === "system" && input.subtype === "local_command") {
            // Older logs may omit the preceding caveat. Retract only a matching
            // command turn; local output must not end a different active task.
            if (this.current?.turnId === string(input.parentUuid))
                this.update("unknown", at, live);
            this.localCommandParent = undefined;
            return;
        }
        if (input.type === "user" && /^\s*<local-command-caveat(?:\s|>)/i.test(title)) {
            this.localCommandParent = string(input.uuid);
            return;
        }
        if (input.type === "user" && !toolResult) {
            const command = /^\s*<command-name>/i.test(title);
            const local = command && this.localCommandParent !== undefined
                && (!input.parentUuid || !this.localCommandParent || input.parentUuid === this.localCommandParent);
            if (command || input.isMeta !== true)
                this.localCommandParent = undefined;
            // Metadata/expanded instructions do not begin a new human turn. A real
            // model-backed slash command without a local caveat remains trackable.
            if (input.isMeta === true || local || isClaudeLocalCommandTitle(title))
                return;
        }
        if ((input.type === "system" && input.subtype === "api_error")
            || (input.type === "assistant" && input.isApiErrorMessage === true)
            || (input.type === "user" && /^\[Request interrupted by user(?: for tool use)?\]/.test(title))
            || (input.type === "assistant" && ["max_tokens", "stop_sequence", "refusal"].includes(stopReason))) {
            // A disconnected/retrying or interrupted turn is not an active response
            // or a successful completion. Real subsequent activity can resume it.
            this.update("unknown", at, live);
            return;
        }
        if (input.type === "user" && !toolResult) {
            // Ignore bookkeeping records with no human prompt.
            if (!title)
                return;
            this.begin(string(input.uuid) || string(input.timestamp) || String(at), at, live);
            if (this.current)
                this.current.title = title;
            this.update("running", at, live);
        }
        else if (input.type === "assistant") {
            if (!this.current)
                this.begin(string(input.uuid) || string(input.timestamp) || String(at), at, live);
            if ((0, core_1.isClaudeMainTaskCompletion)(input))
                this.questions.finishTurn();
            this.update((0, core_1.isClaudeMainTaskCompletion)(input) ? "completed" : "running", at, live);
        }
        else if (toolResult && this.current?.status === "running") {
            this.update("running", at, live);
        }
        else if (input.type === "progress" && this.current?.status === "running") {
            this.update("running", at, live);
        }
    }
    flushBaseline(now = Date.now()) {
        if (!this.current)
            return;
        // Publish only the final replayed state, preserving saved unread results
        // rather than overwriting them with every earlier turn in the file.
        this.emit({ ...this.current, status: this.current.status === "running" ? "unknown" : this.current.status,
            attention: this.questions.attention, live: false, observedAt: now });
    }
    classifyChild(child) {
        this.child ||= child;
        if (this.child && this.current) {
            this.emit(this.current, true);
            this.current = undefined;
        }
    }
    begin(turnId, at, live) {
        if (this.current?.turnId === turnId)
            return;
        if (this.current)
            this.questions.finishTurn();
        this.turnError = false;
        this.current = {
            key: `${this.provider}:${this.source}:${this.sessionId || this.source}`,
            provider: this.provider, sessionId: this.sessionId, turnId, cwd: this.cwd,
            title: "", status: "running", startedAt: at, updatedAt: at, observedAt: this.observedAt, live,
        };
    }
    update(status, at, live) {
        if (!this.current)
            return;
        const finishedAt = status === "completed" || status === "failed" ? this.current.finishedAt ?? at : undefined;
        this.current = { ...this.current, cwd: this.cwd, status, finishedAt, attention: this.questions.attention, updatedAt: at, observedAt: this.observedAt, live };
        if (live)
            this.emit({ ...this.current });
    }
}
exports.SessionActivityTracker = SessionActivityTracker;
