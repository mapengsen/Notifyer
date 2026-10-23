import * as path from "node:path";
import * as vscode from "vscode";
import { StoredSession } from "./floatingState";
import { ProviderStateReader } from "./providerStateReader";
import { claudeUnread, ClaudeReadTracker, isPendingResult, matchingResult, selectedClaudeSession, viewedResult, ViewedResult } from "./sessionSelection";

export class SessionViewMonitor implements vscode.Disposable {
  private readonly reader = new ProviderStateReader();
  private readonly nativeReads = new ClaudeReadTracker();
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly workspaceDatabase: string | undefined;
  private readonly globalDatabase: string;
  private readonly timer: NodeJS.Timeout;
  private selectedTab: vscode.Tab | undefined;
  private selectionAt = 0;
  private selectionResults = new Map<string, ViewedResult>();
  private readonly acknowledged = new Set<string>();
  private selectionTimer: NodeJS.Timeout | undefined;
  private lastError = "";
  private selectedSessionId = "";
  private acknowledgements = 0;

  public constructor(context: vscode.ExtensionContext, private readonly sessions: () => readonly StoredSession[],
    private readonly acknowledge: (result: ViewedResult) => void) {
    this.workspaceDatabase = context.storageUri?.scheme === "file" ? path.join(path.dirname(context.storageUri.fsPath), "state.vscdb") : undefined;
    this.globalDatabase = path.join(path.dirname(context.globalStorageUri.fsPath), "state.vscdb");
    this.selectedTab = vscode.window.tabGroups.activeTabGroup.activeTab;
    this.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => this.selectionChanged()),
      vscode.window.tabGroups.onDidChangeTabGroups(() => this.selectionChanged()),
      vscode.window.onDidChangeWindowState((state) => { if (state.focused) this.schedule(); }));
    this.poll();
    this.timer = setInterval(() => this.poll(), 1000);
  }
  public dispose(): void {
    clearInterval(this.timer);
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    for (const subscription of this.subscriptions) subscription.dispose();
  }
  public getDiagnostics(): Record<string, unknown> {
    return { sqliteSupported: this.reader.supported, selectedSessionId: this.selectedSessionId, acknowledgements: this.acknowledgements, lastError: this.lastError };
  }
  public confirms(session: StoredSession): boolean {
    if (!vscode.window.state.focused || session.provider !== "claude") return false;
    try { return this.activeClaudeSession() === session.sessionId; } catch (error) { this.lastError = String(error); return false; }
  }
  private workspacePaths(): string[] {
    // Claude scopes native unread state to the first workspace folder.
    return (vscode.workspace.workspaceFolders ?? []).slice(0, 1).map((folder) => folder.uri.scheme === "file" ? folder.uri.fsPath : folder.uri.path);
  }
  private activeClaudeSession(): string | undefined {
    const group = vscode.window.tabGroups.activeTabGroup;
    const active = group.activeTab;
    if (!active || !(active.input instanceof vscode.TabInputWebview) || !active.input.viewType.includes("claudeVSCodePanel")) return;
    const state = this.reader.read(this.workspaceDatabase, ["memento/workbench.parts.editor", "Anthropic.claude-code"]);
    if (!state) return;
    return selectedClaudeSession(state["memento/workbench.parts.editor"], state["Anthropic.claude-code"], {
      selected: group.tabs.indexOf(active), tabs: group.tabs.map((tab) => ({ label: tab.label,
        viewType: tab.input instanceof vscode.TabInputWebview ? tab.input.viewType : undefined })),
    });
  }
  private selectionChanged(): void {
    const current = vscode.window.tabGroups.activeTabGroup.activeTab;
    if (current !== this.selectedTab) {
      this.selectedTab = current;
      this.selectionAt = vscode.window.state.focused ? Date.now() : 0;
      // Capture pending results at the click, before persistence catches up.
      // A result completing later must not inherit an earlier selection.
      this.selectionResults = new Map(this.sessions().filter((session) => isPendingResult(session))
        .map((session) => [session.key, viewedResult(session)]));
      this.schedule();
    }
  }
  private schedule(): void {
    if (this.selectionTimer) clearTimeout(this.selectionTimer);
    this.selectionTimer = setTimeout(() => { this.selectionTimer = undefined; this.poll(); }, 150);
  }
  private codexSession(tab: vscode.Tab | undefined): string | undefined {
    const input = tab?.input;
    if (!(input instanceof vscode.TabInputCustom) || input.viewType !== "chatgpt.conversationEditor"
      || input.uri.scheme !== "openai-codex" || input.uri.authority !== "route") return;
    return /^\/(?:local|remote)\/([a-zA-Z0-9_-]+)$/.exec(input.uri.path)?.[1];
  }
  private mark(result: ViewedResult): void {
    if (this.acknowledged.has(result.acknowledgement)) return;
    this.acknowledge(result);
    this.acknowledged.add(result.acknowledgement);
    this.acknowledgements += 1;
  }
  private poll(): void {
    try {
      const sessions = this.sessions();
      const global = this.reader.read(this.globalDatabase, ["Anthropic.claude-code"]);
      const unread = claudeUnread(global?.["Anthropic.claude-code"], this.workspacePaths());
      for (const result of this.nativeReads.consume(unread, sessions)) this.mark(result);
      if (!vscode.window.state.focused) return;
      const active = vscode.window.tabGroups.activeTabGroup.activeTab;
      const codexId = this.codexSession(active);
      const claudeId = codexId ? undefined : this.activeClaudeSession();
      const id = codexId ?? claudeId;
      this.selectedSessionId = id ?? "";
      if (!id) return;
      const session = matchingResult(sessions, codexId ? "codex" : "claude", id);
      if (!isPendingResult(session)) return;
      const explicitlySelected = active === this.selectedTab && Date.now() - this.selectionAt < 70_000;
      // A window focus alone is insufficient. For an already-active Claude
      // panel, additionally require its provider's explicit persisted read state
      // and allow the provider's debounced storage update to finish.
      const nativeRead = Boolean(claudeId && unread && !unread.has(id) && Date.now() - session.updatedAt >= 7500);
      if (!explicitlySelected && !nativeRead) return;
      if (explicitlySelected) {
        const result = this.selectionResults.get(session.key);
        if (!result || !isPendingResult(session, result)) return;
      }
      this.mark(viewedResult(session));
      this.lastError = "";
    } catch (error) { this.lastError = error instanceof Error ? error.message : String(error); }
  }
}
