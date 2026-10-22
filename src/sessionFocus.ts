import { acknowledgementKey, StoredSession } from "./floatingState";

export interface SessionFocusRequest {
  type: "focus";
  key?: string;
  provider?: string;
  sessionId?: string;
  turnId?: string;
  acknowledgement?: string;
  requestedAt?: number;
}

export interface SessionFocusHost {
  getSession(key: string): StoredSession | undefined;
  focusWindow(): Promise<boolean>;
  openSession(session: StoredSession): Promise<boolean>;
  isCurrentAndFocused(): boolean;
  acknowledge(key: string): void;
}

/** A window activation alone is never evidence that a particular result was read. */
export async function focusSession(request: SessionFocusRequest, host: SessionFocusHost): Promise<"failed" | "window-only" | "opened" | "viewed"> {
  const session = request.key ? host.getSession(request.key) : undefined;
  const target = session && request.provider === session.provider && request.sessionId === session.sessionId
    && request.turnId === session.turnId && request.acknowledgement === acknowledgementKey(session)
    && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(session.sessionId) ? { ...session } : undefined;
  if (!host.isCurrentAndFocused() && !await host.focusWindow()) return "failed";
  if (!target || !host.isCurrentAndFocused()) return "window-only";
  if (!await host.openSession(target) || !host.isCurrentAndFocused()) return "window-only";
  const latest = host.getSession(target.key);
  // Scope the acknowledgement to the clicked result, not merely the session.
  // A new turn/completion arriving while navigation is pending stays unread.
  if (latest?.turnId === target.turnId && latest.unread && latest.status === target.status
    && ["completed", "failed"].includes(target.status)) {
    host.acknowledge(acknowledgementKey(target));
    return "viewed";
  }
  return "opened";
}
