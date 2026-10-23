"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.focusSession = focusSession;
const floatingState_1 = require("./floatingState");
/** A window activation alone is never evidence that a particular result was read. */
async function focusSession(request, host) {
    const session = request.key ? host.getSession(request.key) : undefined;
    const target = session && request.provider === session.provider && request.sessionId === session.sessionId
        && request.turnId === session.turnId && request.acknowledgement === (0, floatingState_1.acknowledgementKey)(session)
        && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(session.sessionId) ? { ...session } : undefined;
    if (!host.isCurrentAndFocused() && !await host.focusWindow())
        return "failed";
    if (!target || !host.isCurrentAndFocused())
        return "window-only";
    if (!await host.openSession(target) || !host.isCurrentAndFocused())
        return "window-only";
    const latest = host.getSession(target.key);
    // Scope the acknowledgement to the clicked result, not merely the session.
    // A new turn/completion arriving while navigation is pending stays unread.
    if (latest?.turnId === target.turnId && latest.unread && latest.status === target.status
        && ["completed", "failed"].includes(target.status)) {
        host.acknowledge((0, floatingState_1.acknowledgementKey)(target));
        return "viewed";
    }
    return "opened";
}
