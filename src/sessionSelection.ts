import { acknowledgementKey, StoredSession } from "./floatingState";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
}
function decode(value: unknown): ObjectValue {
  try { return object(typeof value === "string" ? JSON.parse(value) : value); } catch { return {}; }
}
const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
export interface ViewedResult { key: string; turnId: string; acknowledgement: string; status: StoredSession["status"] }
export interface SelectedTabGroup {
  selected: number;
  tabs: Array<{ label: string; viewType?: string }>;
}

/** Bind the live tab position to serialized session IDs, never to prompt text. */
export function selectedClaudeSession(editorState: unknown, providerState: unknown, live: SelectedTabGroup): string | undefined {
  if (!Number.isInteger(live.selected) || live.selected < 0 || live.selected >= live.tabs.length) return;
  const groups: ObjectValue[] = [];
  function collect(value: unknown, depth = 0): void {
    if (depth > 20) return;
    const node = object(value);
    if (node.type === "leaf") {
      const group = object(node.data);
      if (Array.isArray(group.editors)) groups.push(group);
    } else if (Array.isArray(node.data)) for (const child of node.data) collect(child, depth + 1);
  }
  collect(object(object(decode(editorState)["editorpart.state"]).serializedGrid).root);
  const candidates = groups.filter((group) => {
    const editors = group.editors as unknown[];
    return editors.length === live.tabs.length && editors.every((entry, index) => {
      const saved = decode(object(entry).value);
      return typeof saved.title === "string" && saved.title === live.tabs[index].label
        && typeof saved.viewType === "string" && saved.viewType === live.tabs[index].viewType;
    });
  });
  if (candidates.length !== 1) return;
  // Equal-looking tabs could have been reordered since the last persisted
  // snapshot. Ambiguous layouts are left unread until a reliable signal exists.
  const fingerprints = live.tabs.map((tab) => JSON.stringify([tab.viewType, tab.label]));
  if (new Set(fingerprints).size !== fingerprints.length) return;
  const saved = decode(object((candidates[0].editors as unknown[])[live.selected]).value);
  if (String(saved.extensionId).toLowerCase() !== "anthropic.claude-code"
    || !String(saved.viewType).includes("claudeVSCodePanel")) return;
  const sessionId = decode(saved.state).sessionID;
  if (typeof sessionId !== "string" || !sessionIdPattern.test(sessionId)) return;
  const panels = decode(providerState).panelTabSessions;
  // Provider bindings update independently of workbench persistence. Requiring
  // both rejects a webview that has since been reused for a different session.
  if (!Array.isArray(panels) || !panels.some((panel) => object(panel).sessionId === sessionId && object(panel).title === saved.title)) return;
  return sessionId;
}

export function claudeUnread(globalState: unknown, workspacePaths: readonly string[]): Set<string> | undefined {
  const state = decode(globalState);
  const normalize = (value: string): string => {
    const root = value.replace(/[\\/]+$/, "").replace(/[/\\]\.claude[/\\]worktrees[/\\][^/\\]+$/, "");
    return /^[a-z]:[/\\]/i.test(root) ? root.replace(/\\/g, "/").toLowerCase() : root;
  };
  const roots = new Set(workspacePaths.map(normalize));
  const matching = Object.entries(state).filter(([key, value]) => key.startsWith("sessionUnread:")
    && roots.has(normalize(key.slice("sessionUnread:".length))) && Array.isArray(value));
  if (!matching.length) return;
  const result = new Set<string>();
  for (const [, entries] of matching) for (const entry of entries as unknown[]) {
    if (typeof entry === "string" && sessionIdPattern.test(entry)) result.add(entry);
  }
  return result;
}

/** In the VS Code provider, "local" denotes the connected provider's execution environment. */
export function codexUnread(globalState: unknown, hostId = "local"): Set<string> | undefined {
  const atoms = decode(decode(globalState)["persisted-atom-state"]);
  const entries = object(atoms["unread-thread-ids-by-host-v1"])[hostId];
  if (!Array.isArray(entries) || !entries.every((id) => typeof id === "string" && sessionIdPattern.test(id))) return;
  return new Set(entries as string[]);
}

export function viewedResult(session: StoredSession): ViewedResult {
  return { key: session.key, turnId: session.turnId, acknowledgement: acknowledgementKey(session), status: session.status };
}
export function matchingResult(sessions: readonly StoredSession[], provider: "codex" | "claude", sessionId: string): StoredSession | undefined {
  const matches = sessions.filter((session) => session.provider === provider && session.sessionId === sessionId);
  return matches.length === 1 ? matches[0] : undefined;
}
export function isPendingResult(session: StoredSession | undefined, result?: ViewedResult): session is StoredSession {
  return Boolean(session?.unread && ["completed", "failed"].includes(session.status)
    && (!result || session.key === result.key && session.turnId === result.turnId && session.status === result.status
      && acknowledgementKey(session) === result.acknowledgement));
}

/** Native read transitions are keyed by session; retain the observed turn too. */
export class NativeReadTracker {
  private previous: Map<string, ViewedResult | undefined> | undefined;
  public constructor(private readonly provider: StoredSession["provider"]) {}
  public consume(unread: Set<string> | undefined, sessions: readonly StoredSession[]): ViewedResult[] {
    if (!unread) return []; // Missing/corrupt state is never an empty unread list.
    const next = new Map<string, ViewedResult | undefined>();
    for (const id of unread) {
      const session = matchingResult(sessions, this.provider, id);
      next.set(id, this.previous?.get(id) ?? (isPendingResult(session) ? viewedResult(session) : undefined));
    }
    const results: ViewedResult[] = [];
    for (const [id, observed] of this.previous ?? []) {
      if (next.has(id) || !observed) continue;
      const latest = matchingResult(sessions, this.provider, id);
      if (isPendingResult(latest, observed)) results.push(observed);
    }
    this.previous = next;
    return results;
  }
}
export class ClaudeReadTracker extends NativeReadTracker {
  public constructor() { super("claude"); }
}
