import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import * as vm from "node:vm";

/** Exercise real startup/commands with a fake native helper, without opening UI. */
function fixture(options: { enabled?: boolean; visible?: boolean; oldShow?: boolean } = {}) {
  const storage = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-startup-"));
  const root = path.join(storage, "floating-panel");
  fs.mkdirSync(root);
  const heartbeat = path.join(root, "panel-heartbeat.json");
  const control = path.join(root, "control.json");
  const write = (file: string, value: unknown) => fs.writeFileSync(file, JSON.stringify(value));
  if (options.oldShow) write(control, { type: "show", id: "old-show", requestedAt: Date.now() - 3600000 });
  if (options.visible !== undefined) write(heartbeat, { pid: 42, version: "test", updatedAt: Date.now(), visible: options.visible });
  let enabled = options.enabled ?? true;
  const spawns: string[][] = [];
  const callbacks = new Map<string, () => Promise<void>>();
  const changes: Array<(event: { affectsConfiguration: (name: string) => boolean }) => void> = [];
  const disposable = { dispose() {} };
  const api = {
    StatusBarAlignment: { Right: 1 }, ConfigurationTarget: { Global: 1 }, env: {},
    window: { createStatusBarItem: () => ({ show() {}, dispose() {} }),
      createOutputChannel: () => ({ appendLine() {}, dispose() {} }), state: { focused: true } },
    workspace: { name: "Project", workspaceFolders: [{ uri: { scheme: "file", fsPath: "C:/project", toString: () => "file:///C:/project" } }],
      getConfiguration: (section: string) => ({
        get: (name: string, fallback: unknown) => section === "codexTaskCompanion.floatingWindow" && name === "enabled" ? enabled : fallback,
        update: async (_: string, value: boolean) => { enabled = value; changes.forEach((callback) => callback({ affectsConfiguration: (name) => name === "codexTaskCompanion.floatingWindow" })); },
      }), onDidChangeConfiguration: (callback: (event: any) => void) => { changes.push(callback); return disposable; } },
    commands: { registerCommand: (name: string, callback: () => Promise<void>) => { callbacks.set(name, callback); return disposable; } },
  };
  const context = { globalStorageUri: { fsPath: storage }, extensionPath: "C:/installed/Notifyer", extension: { packageJSON: { version: "0.4.26" } }, subscriptions: [] };
  const file = path.resolve(__dirname, "../floatingPanel.js");
  const localRequire = createRequire(file);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), { module, exports: module.exports, console, Date,
    process: { platform: "win32", pid: 42, env: { SystemRoot: "C:\\Windows" } },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    require: (name: string) => {
      if (name === "vscode") return api;
      if (name === "./notify") return { areDesktopNotificationsEnabled: () => false, getNotificationDiagnostics: () => ({}) };
      if (name === "./sessionViewMonitor") return { SessionViewMonitor: class { dispose() {} getDiagnostics() { return {}; } } };
      if (name === "./sessionNavigator") return {};
      if (name === "./sessionSelection") return {};
      if (name === "node:child_process") return { spawn: (_: string, args: string[]) => {
        spawns.push(args);
        write(heartbeat, { pid: 42, version: "test", updatedAt: Date.now(), visible: !args.includes("-StartHidden") });
        const stream = () => Object.assign(new EventEmitter(), { setEncoding() {} });
        return Object.assign(new EventEmitter(), { stdout: stream(), stderr: stream(), unref() {} });
      } };
      return localRequire(name);
    },
  });
  const panel = new (module.exports as any).FloatingPanel(context);
  return { root, heartbeat, control, panel, spawns, command: (name: string) => callbacks.get(`codexTaskCompanion.${name}`)!(),
    close: () => {
      panel.dispose();
      assert.equal(path.resolve(path.dirname(storage)), path.resolve(os.tmpdir()));
      fs.rmSync(storage, { recursive: true, force: true });
    } };
}

test("default startup launches hidden without creating a show request and keeps collecting activity", () => {
  const f = fixture();
  try {
    assert.equal(f.spawns.length, 1);
    assert.ok(f.spawns[0].includes("-StartHidden"));
    assert.equal(fs.existsSync(f.control), false);
    f.panel.accept({ key: "codex:test", provider: "codex", sessionId: "session", turnId: "turn", title: "Task", cwd: "C:/project", status: "running", startedAt: Date.now(), updatedAt: Date.now(), live: true });
    assert.equal(f.panel.getDiagnostics().sessionCount, 1);
  } finally { f.close(); }
});

test("a stale persisted show request is ignored by default startup", () => {
  const f = fixture({ oldShow: true });
  try {
    const args = f.spawns[0];
    assert.ok(args.includes("-StartHidden"));
    assert.equal(args[args.indexOf("-InitialControlId") + 1], "old-show");
    assert.equal(JSON.parse(fs.readFileSync(f.control, "utf8")).id, "old-show");
  } finally { f.close(); }
});

test("opening another VS Code window does not change a healthy panel's manual visibility", () => {
  for (const visible of [false, true]) {
    const f = fixture({ visible });
    try {
      assert.equal(f.spawns.length, 0);
      assert.equal(fs.existsSync(f.control), false);
      assert.equal(f.panel.getDiagnostics().floatingWindowVisible, visible);
    } finally { f.close(); }
  }
});

test("manual show opens an existing hidden panel and explicitly shows a missing helper", async () => {
  const f = fixture();
  try {
    await f.command("toggleFloatingWindow");
    assert.equal(JSON.parse(fs.readFileSync(f.control, "utf8")).type, "show");
    assert.equal(f.spawns.length, 1);
    fs.unlinkSync(f.heartbeat);
    await f.command("showFloatingWindow");
    assert.equal(f.spawns.length, 2);
    assert.equal(f.spawns[1].includes("-StartHidden"), false);
  } finally { f.close(); }
});

test("manually enabling collection refreshes the show request after a hidden startup", async () => {
  const f = fixture({ enabled: false });
  try {
    assert.equal(f.spawns.length, 0);
    await f.command("showFloatingWindow");
    const args = f.spawns[0];
    const ignored = args[args.indexOf("-InitialControlId") + 1];
    const request = JSON.parse(fs.readFileSync(f.control, "utf8"));
    assert.ok(args.includes("-StartHidden"));
    assert.equal(request.type, "show");
    assert.notEqual(request.id, ignored);
  } finally { f.close(); }
});

test("automatic helper recovery keeps the default hidden behavior", () => {
  const f = fixture();
  try {
    fs.unlinkSync(f.heartbeat);
    f.panel.lastLaunchAt = Date.now() - 30000;
    f.panel.tick();
    assert.equal(f.spawns.length, 2);
    assert.ok(f.spawns[1].includes("-StartHidden"));
  } finally { f.close(); }
});
