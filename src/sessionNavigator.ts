import * as vscode from "vscode";
import { SessionNavigationDiagnostics, StoredSession } from "./floatingState";

/** Use provider-specific session selectors; generic sidebar/focus commands are unsafe. */
export async function openSession(session: StoredSession, confirmsClaudeSelection?: (session: StoredSession) => boolean,
  report?: (diagnostics: SessionNavigationDiagnostics) => void): Promise<boolean> {
  const extensionId = session.provider === "claude" ? "anthropic.claude-code" : "openai.chatgpt";
  const extension = vscode.extensions.getExtension(extensionId);
  const trace = (phase: string, selectorAvailable?: boolean): void => report?.({ provider: session.provider,
    sessionId: session.sessionId, localExtensionVisible: Boolean(extension), selectorAvailable, phase, at: Date.now() });
  // A Remote window may also monitor local logs. Those sessions must not be
  // opened in a provider whose backend belongs to a different environment.
  const source = session.key.slice(session.provider.length + 1, -(session.sessionId.length + 1));
  if (!source.startsWith("file:") && !source.startsWith("vscode-remote:")) { trace("invalid-source"); return false; }
  const remoteSource = source.startsWith("vscode-remote:");
  if (remoteSource && !vscode.env.remoteName) { trace("remote-window-required"); return false; }
  if (!remoteSource && vscode.env.remoteName && (!extension || extension.extensionKind === vscode.ExtensionKind.Workspace)) {
    trace("source-environment-mismatch"); return false;
  }
  if (remoteSource && !vscode.workspace.workspaceFolders?.some((folder) => folder.uri.authority === vscode.Uri.parse(source).authority)) {
    trace("remote-authority-mismatch"); return false;
  }
  // The stable extension API only exposes extensions in this extension host.
  // A local UI extension must use globally registered commands/editor selectors
  // to reach providers in the Remote SSH / WSL / container extension host.
  if (extension) await extension.activate();
  if (session.provider === "claude") {
    const command = "claude-vscode.editor.open";
    const available = (await vscode.commands.getCommands(true)).includes(command);
    if (!available) { trace("selector-unavailable", false); return false; }
    // Claude's command accepts a session ID and reuses that exact chat surface.
    // Never fall back to openLast, a new conversation, or a generic focus command.
    const previous = vscode.window.tabGroups.activeTabGroup.activeTab;
    trace("opening-session", true);
    await vscode.commands.executeCommand(command, session.sessionId, undefined, undefined, undefined, true);
    // Prefer the validated live-tab/session binding, including already-active
    // editors. Command completion alone never proves which result was viewed.
    for (let elapsed = 0; elapsed <= 2000; elapsed += 50) {
      if (confirmsClaudeSelection?.(session)) { trace("session-id-confirmed", true); return true; }
      const selected = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (!confirmsClaudeSelection && selected && selected !== previous && selected.input instanceof vscode.TabInputWebview
        && selected.input.viewType.includes("claudeVSCodePanel")) { trace("provider-editor-selected", true); return true; }
      if (elapsed < 2000) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    trace("session-not-confirmed", true); return false;
  }
  if (extension && !extension.packageJSON.contributes?.customEditors?.some((item: { viewType?: string }) => item.viewType === "chatgpt.conversationEditor")) {
    trace("selector-unavailable", false); return false;
  }
  const uri = vscode.Uri.from({ scheme: "openai-codex", authority: "route", path: `/local/${session.sessionId}` });
  trace("opening-session");
  await vscode.commands.executeCommand("vscode.openWith", uri, "chatgpt.conversationEditor", { preserveFocus: false, preview: false });
  const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  const confirmed = active instanceof vscode.TabInputCustom && active.viewType === "chatgpt.conversationEditor"
    && active.uri.scheme === uri.scheme && active.uri.authority === uri.authority && active.uri.path === uri.path;
  trace(confirmed ? "session-id-confirmed" : "session-not-confirmed", true);
  return confirmed;
}
