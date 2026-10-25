"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_events_1 = require("node:events");
const fs = __importStar(require("node:fs"));
const node_module_1 = require("node:module");
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const vm = __importStar(require("node:vm"));
/** Exercise real startup/commands with a fake native helper, without opening UI. */
function fixture(options = {}) {
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-startup-"));
    const root = path.join(storage, "floating-panel");
    fs.mkdirSync(root);
    const heartbeat = path.join(root, "panel-heartbeat.json");
    const control = path.join(root, "control.json");
    const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value));
    if (options.oldShow)
        write(control, { type: "show", id: "old-show", requestedAt: Date.now() - 3600000 });
    if (options.visible !== undefined)
        write(heartbeat, { pid: 42, version: "test", updatedAt: Date.now(), visible: options.visible });
    let enabled = options.enabled ?? true;
    const spawns = [];
    const callbacks = new Map();
    const changes = [];
    const disposable = { dispose() { } };
    const api = {
        StatusBarAlignment: { Right: 1 }, ConfigurationTarget: { Global: 1 }, env: {},
        window: { createStatusBarItem: () => ({ show() { }, dispose() { } }),
            createOutputChannel: () => ({ appendLine() { }, dispose() { } }), state: { focused: true } },
        workspace: { name: "Project", workspaceFolders: [{ uri: { scheme: "file", fsPath: "C:/project", toString: () => "file:///C:/project" } }],
            getConfiguration: (section) => ({
                get: (name, fallback) => section === "codexTaskCompanion.floatingWindow" && name === "enabled" ? enabled : fallback,
                update: async (_, value) => { enabled = value; changes.forEach((callback) => callback({ affectsConfiguration: (name) => name === "codexTaskCompanion.floatingWindow" })); },
            }), onDidChangeConfiguration: (callback) => { changes.push(callback); return disposable; } },
        commands: { registerCommand: (name, callback) => { callbacks.set(name, callback); return disposable; } },
    };
    const context = { globalStorageUri: { fsPath: storage }, extensionPath: "C:/installed/Notifyer", extension: { packageJSON: { version: "0.4.26" } }, subscriptions: [] };
    const file = path.resolve(__dirname, "../floatingPanel.js");
    const localRequire = (0, node_module_1.createRequire)(file);
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(file, "utf8"), { module, exports: module.exports, console, Date,
        process: { platform: "win32", pid: 42, env: { SystemRoot: "C:\\Windows" } },
        setInterval: () => 1, clearInterval() { }, setTimeout: () => 1, clearTimeout() { },
        require: (name) => {
            if (name === "vscode")
                return api;
            if (name === "./notify")
                return { areDesktopNotificationsEnabled: () => false, getNotificationDiagnostics: () => ({}) };
            if (name === "./sessionViewMonitor")
                return { SessionViewMonitor: class {
                        dispose() { }
                        getDiagnostics() { return {}; }
                    } };
            if (name === "./sessionNavigator")
                return {};
            if (name === "./sessionSelection")
                return {};
            if (name === "node:child_process")
                return { spawn: (_, args) => {
                        spawns.push(args);
                        write(heartbeat, { pid: 42, version: "test", updatedAt: Date.now(), visible: !args.includes("-StartHidden") });
                        const stream = () => Object.assign(new node_events_1.EventEmitter(), { setEncoding() { } });
                        return Object.assign(new node_events_1.EventEmitter(), { stdout: stream(), stderr: stream(), unref() { } });
                    } };
            return localRequire(name);
        },
    });
    const panel = new module.exports.FloatingPanel(context);
    return { root, heartbeat, control, panel, spawns, command: (name) => callbacks.get(`codexTaskCompanion.${name}`)(),
        close: () => {
            panel.dispose();
            strict_1.default.equal(path.resolve(path.dirname(storage)), path.resolve(os.tmpdir()));
            fs.rmSync(storage, { recursive: true, force: true });
        } };
}
(0, node_test_1.default)("default startup launches hidden without creating a show request and keeps collecting activity", () => {
    const f = fixture();
    try {
        strict_1.default.equal(f.spawns.length, 1);
        strict_1.default.ok(f.spawns[0].includes("-StartHidden"));
        strict_1.default.equal(fs.existsSync(f.control), false);
        f.panel.accept({ key: "codex:test", provider: "codex", sessionId: "session", turnId: "turn", title: "Task", cwd: "C:/project", status: "running", startedAt: Date.now(), updatedAt: Date.now(), live: true });
        strict_1.default.equal(f.panel.getDiagnostics().sessionCount, 1);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("a stale persisted show request is ignored by default startup", () => {
    const f = fixture({ oldShow: true });
    try {
        const args = f.spawns[0];
        strict_1.default.ok(args.includes("-StartHidden"));
        strict_1.default.equal(args[args.indexOf("-InitialControlId") + 1], "old-show");
        strict_1.default.equal(JSON.parse(fs.readFileSync(f.control, "utf8")).id, "old-show");
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("opening another VS Code window does not change a healthy panel's manual visibility", () => {
    for (const visible of [false, true]) {
        const f = fixture({ visible });
        try {
            strict_1.default.equal(f.spawns.length, 0);
            strict_1.default.equal(fs.existsSync(f.control), false);
            strict_1.default.equal(f.panel.getDiagnostics().floatingWindowVisible, visible);
        }
        finally {
            f.close();
        }
    }
});
(0, node_test_1.default)("manual show opens an existing hidden panel and explicitly shows a missing helper", async () => {
    const f = fixture();
    try {
        await f.command("toggleFloatingWindow");
        strict_1.default.equal(JSON.parse(fs.readFileSync(f.control, "utf8")).type, "show");
        strict_1.default.equal(f.spawns.length, 1);
        fs.unlinkSync(f.heartbeat);
        await f.command("showFloatingWindow");
        strict_1.default.equal(f.spawns.length, 2);
        strict_1.default.equal(f.spawns[1].includes("-StartHidden"), false);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("manually enabling collection refreshes the show request after a hidden startup", async () => {
    const f = fixture({ enabled: false });
    try {
        strict_1.default.equal(f.spawns.length, 0);
        await f.command("showFloatingWindow");
        const args = f.spawns[0];
        const ignored = args[args.indexOf("-InitialControlId") + 1];
        const request = JSON.parse(fs.readFileSync(f.control, "utf8"));
        strict_1.default.ok(args.includes("-StartHidden"));
        strict_1.default.equal(request.type, "show");
        strict_1.default.notEqual(request.id, ignored);
    }
    finally {
        f.close();
    }
});
(0, node_test_1.default)("automatic helper recovery keeps the default hidden behavior", () => {
    const f = fixture();
    try {
        fs.unlinkSync(f.heartbeat);
        f.panel.lastLaunchAt = Date.now() - 30000;
        f.panel.tick();
        strict_1.default.equal(f.spawns.length, 2);
        strict_1.default.ok(f.spawns[1].includes("-StartHidden"));
    }
    finally {
        f.close();
    }
});
