"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionQuestions = void 0;
function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function text(value) { return typeof value === "string" ? value : ""; }
function parse(value) {
    if (typeof value !== "string")
        return object(value);
    try {
        return object(JSON.parse(value));
    }
    catch {
        return {};
    }
}
/** Track actual tool requests/replies, independently from whether a turn is running. */
class SessionQuestions {
    pending = new Map();
    get attention() {
        const entries = [...this.pending.entries()];
        if (!entries.length)
            return undefined;
        return { requestIds: entries.map(([id]) => id),
            count: entries.reduce((count, [, item]) => count + item.questions.size, 0),
            message: entries[0][1].questions.values().next().value ?? "有问题等待你的回答",
            askedAt: entries[0][1].askedAt };
    }
    reset() { this.pending.clear(); }
    finishTurn() {
        for (const [id, item] of this.pending)
            if (!item.asynchronous)
                this.pending.delete(id);
    }
    consumeCodex(payload, at) {
        const name = text(payload.name).split(".").at(-1);
        const id = text(payload.call_id);
        if (payload.type === "function_call" && ["request_user_input", "request_user_input_async"].includes(name ?? "")) {
            this.add(id, parse(payload.arguments).questions, name === "request_user_input_async", at);
        }
        else if (payload.type === "function_call_output" && this.pending.has(id)) {
            const result = parse(payload.output);
            // Async acceptance only creates the question UI; the answer arrives in a
            // later user message, potentially after the requesting turn has finished.
            if (!this.pending.get(id).asynchronous || result.accepted !== true)
                this.pending.delete(id);
        }
        else if (payload.type === "message" && payload.role === "user") {
            this.consumeReplyText(this.messageText(payload));
        }
    }
    consumeClaude(input, at) {
        const content = object(input.message).content;
        if (!Array.isArray(content))
            return;
        for (const value of content) {
            const block = object(value);
            if (input.type === "assistant" && block.type === "tool_use" && block.name === "AskUserQuestion") {
                this.add(text(block.id), object(block.input).questions, false, at);
            }
            else if (input.type === "user" && block.type === "tool_result") {
                this.pending.delete(text(block.tool_use_id));
            }
        }
    }
    consumeReplyText(value) {
        for (const match of value.matchAll(/<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/g)) {
            let replies;
            try {
                replies = JSON.parse(match[1]);
            }
            catch {
                continue;
            }
            if (!Array.isArray(replies))
                continue;
            for (const reply of replies) {
                let identity = object(reply).questionItemId;
                if (typeof identity === "string") {
                    try {
                        identity = JSON.parse(identity);
                    }
                    catch {
                        continue;
                    }
                }
                if (!Array.isArray(identity) || identity[0] !== "request_user_input_async")
                    continue;
                const id = text(identity[1]);
                const item = this.pending.get(id);
                if (!item?.asynchronous)
                    continue;
                item.questions.delete(String(identity[2]));
                if (!item.questions.size)
                    this.pending.delete(id);
            }
        }
    }
    messageText(message) {
        if (typeof message.content === "string")
            return message.content;
        return Array.isArray(message.content) ? message.content.map((item) => text(object(item).text)).join("\n") : "";
    }
    add(id, values, asynchronous, at) {
        if (!id || !Array.isArray(values) || !values.length || this.pending.has(id))
            return;
        const questions = new Map(values.map((value, index) => {
            const item = object(value);
            return [String(index), (text(item.question) || text(item.title) || "有问题等待你的回答").replace(/\s+/g, " ").slice(0, 300)];
        }));
        this.pending.set(id, { asynchronous, questions, askedAt: at });
    }
}
exports.SessionQuestions = SessionQuestions;
