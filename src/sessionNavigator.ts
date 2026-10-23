import * as vscode from "vscode";
import { StoredSession } from "./floatingState";

/** Use provider-specific session selectors; generic sidebar/focus commands are unsafe. */
export async function openSession(session: StoredSession, confirmsClaudeSelection?: (session: StoredSession) => boolean): Promise<boolean> {
  const extensionId = session.provider === "claude" ? "anthropic.claude-code" : "openai.chatgpt";
  const extension = vscode.extensions.getExtension(extensionId);
  if (!extension) return false;
  // A Remote window may also monitor local logs. Those sessions must not be
  // opened in a provider whose backend belongs to a different environment.
  const source = session.key.slice(session.provider.length + 1, -(session.sessionId.length + 1));
  if (!source.startsWith("file:") && !source.startsWith("vscode-remote:")) return false;
  const remoteSource = source.startsWith("vscode-remote:");
  if (remoteSource && !vscode.env.remoteName) return false;
  const remoteProvider = Boolean(vscode.env.remoteName) && extension.extensionKind === vscode.ExtensionKind.Workspace;
  if (session.provider === "codex" && remoteSource !== remoteProvider) return false;
  if (!remoteSource && remoteProvider) return false;
  if (remoteSource && !vscode.workspace.workspaceFolders?.some((folder) => folder.uri.authority === vscode.Uri.parse(source).authority)) return false;
  await extension.activate();
  if (session.provider === "claude") {
    const command = "claude-vscode.editor.open";
    if (!(await vscode.commands.getCommands(true)).includes(command)) return false;
    // Claude's command accepts a session ID and reuses that exact chat surface.
    // Never fall back to openLast, a new conversation, or a generic focus command.
    const previous = vscode.window.tabGroups.activeTabGroup.activeTab;
    await vscode.commands.executeCommand(command, session.sessionId, undefined, undefined, undefined, true);
    // Prefer the validated live-tab/session binding, including already-active
    // editors. Command completion alone never proves which result was viewed.
    for (let elapsed = 0; elapsed <= 2000; elapsed += 50) {
      if (confirmsClaudeSelection?.(session)) return true;
      const selected = vscode.window.tabGroups.activeTabGroup.activeTab;
      if (remoteSource === remoteProvider && selected && selected !== previous && selected.input instanceof vscode.TabInputWebview
        && selected.input.viewType.includes("claudeVSCodePanel")) return true;
      if (elapsed < 2000) await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    return false;
  }
  if (!extension.packageJSON.contributes?.customEditors?.some((item: { viewType?: string }) => item.viewType === "chatgpt.conversationEditor")) return false;
  const uri = vscode.Uri.from({ scheme: "openai-codex", authority: "route", path: `/local/${session.sessionId}` });
  await vscode.commands.executeCommand("vscode.openWith", uri, "chatgpt.conversationEditor", { preserveFocus: false, preview: false });
  const active = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return active instanceof vscode.TabInputCustom && active.viewType === "chatgpt.conversationEditor"
    && active.uri.scheme === uri.scheme && active.uri.authority === uri.authority && active.uri.path === uri.path;
}
