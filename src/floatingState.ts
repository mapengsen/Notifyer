import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { SessionActivity } from "./sessionActivity";

export interface StoredSession extends SessionActivity {
  unread: boolean;
}
export interface WindowSnapshot {
  version: 1;
  windowId: string;
  project: string;
  workspace: string;
  environment: string;
  windowHandle: string;
  pid: number;
  heartbeat: number;
  closed?: boolean;
  sessions: StoredSession[];
}
export interface PanelRow extends StoredSession {
  owners: Array<{ windowId: string; label: string; online: boolean }>;
  acknowledgement: string;
}
export interface PanelHeartbeat {
  pid: number;
  updatedAt: number;
  visible: boolean;
  version: string;
  controlId?: string;
}
export interface PanelVisibilityRequest {
  type: "show" | "hide";
  id: string;
  requestedAt: number;
}
export function panelVisibility(
  heartbeat: PanelHeartbeat | undefined,
  request: PanelVisibilityRequest | undefined,
  now = Date.now(),
): boolean {
  // Reflect a click immediately, including clicks originating in another window.
  // The helper's acknowledgement takes over as soon as it consumes the request.
  if (request && request.id !== heartbeat?.controlId && ["show", "hide"].includes(request.type)
    && now - request.requestedAt >= -1000 && now - request.requestedAt < 10_000) {
    return request.type === "show";
  }
  return isPanelHealthy(heartbeat, now) && heartbeat!.visible;
}
export function isPanelHealthy(heartbeat: PanelHeartbeat | undefined, now = Date.now()): boolean {
  // A hidden panel is healthy too: it must never be reopened by the watchdog.
  return Boolean(heartbeat && Number.isInteger(heartbeat.pid) && heartbeat.pid > 0
    && Number.isFinite(heartbeat.updatedAt) && now - heartbeat.updatedAt >= -1000
    && now - heartbeat.updatedAt < 15_000);
}
export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function acknowledgementKey(session: SessionActivity): string {
  return digest(`${session.key}:${session.turnId}`);
}
export function applyActivity(previous: StoredSession | undefined, incoming: SessionActivity): StoredSession {
  if (previous && incoming.updatedAt < previous.updatedAt) return previous;
  const sameTurn = previous?.turnId === incoming.turnId;
  return {
    ...incoming,
    unread: ["completed", "failed"].includes(incoming.status)
      && (sameTurn && previous?.status === incoming.status ? previous.unread : incoming.live),
  };
}
export function atomicWriteJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value), "utf8");
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

/** Deduplicate the same session observed by several windows; retain all owners. */
export function aggregateSessions(
  snapshots: WindowSnapshot[],
  acknowledged: (key: string) => boolean,
  now = Date.now(),
  quietAfterMs = 30 * 60_000,
): PanelRow[] {
  const grouped = new Map<string, { session: StoredSession; owners: PanelRow["owners"]; online: boolean }>();
  for (const snapshot of snapshots) {
    const online = !snapshot.closed && now - snapshot.heartbeat < 15_000;
    for (const session of snapshot.sessions) {
      const old = grouped.get(session.key);
      const owner = { windowId: snapshot.windowId, label: `${snapshot.project} · ${snapshot.environment}`, online };
      if (!old) grouped.set(session.key, { session, owners: [owner], online });
      else {
        old.owners.push(owner);
        old.online ||= online;
        if (session.updatedAt > old.session.updatedAt || (session.updatedAt === old.session.updatedAt && session.unread)) {
          old.session = session;
        }
      }
    }
  }
  const rows: PanelRow[] = [];
  for (const { session, owners, online } of grouped.values()) {
    const acknowledgement = acknowledgementKey(session);
    const unread = session.unread && !acknowledged(acknowledgement);
    // Old viewed history is intentionally omitted; pending results remain visible.
    if (!unread && ["completed", "failed"].includes(session.status)
      && session.updatedAt < now - 24 * 60 * 60_000) continue;
    rows.push({
      ...session, unread, acknowledgement, owners: owners.sort((a, b) => Number(b.online) - Number(a.online)),
      status: session.status === "running" && (!online || now - session.updatedAt > quietAfterMs) ? "unknown" : session.status,
    });
  }
  const priority = (item: PanelRow): number => item.unread ? 0 : item.status === "running" ? 1 : item.status === "unknown" ? 2 : 3;
  return rows.sort((a, b) => priority(a) - priority(b) || b.updatedAt - a.updatedAt);
}
