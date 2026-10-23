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
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const core_1 = require("../core");
const notificationClaimStore_1 = require("../notificationClaimStore");
(0, node_test_1.default)("remote home inference supports mounted user homes and preserves standard layouts", () => {
    for (const [workspace, home] of [
        ["/data/home/mapengsen/opticaldna_pixel", "/data/home/mapengsen"],
        ["/mnt/data/home/scwc385/run", "/mnt/data/home/scwc385"],
        ["/home/user/project", "/home/user"], ["/Users/user/project", "/Users/user"],
        ["/root/project", "/root"], ["/root", "/root"],
    ])
        strict_1.default.equal((0, core_1.remoteHomeFromWorkspacePath)(workspace), home);
    strict_1.default.equal((0, core_1.remoteHomeFromWorkspacePath)("/srv/project"), undefined);
    strict_1.default.equal((0, core_1.remoteHomeFromWorkspacePath)("/data/home"), undefined);
    strict_1.default.equal((0, core_1.remoteHomeFromWorkspacePath)("/root-other/project"), undefined);
});
(0, node_test_1.default)("initial session scan is silent unless explicitly enabled", () => {
    strict_1.default.equal((0, core_1.shouldNotifySessionCompletion)(false, false), false);
    strict_1.default.equal((0, core_1.shouldNotifySessionCompletion)(false, true), true);
    strict_1.default.equal((0, core_1.shouldNotifySessionCompletion)(true, false), true);
});
(0, node_test_1.default)("notification claims are shared atomically across extension hosts", () => {
    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-claims-"));
    try {
        const firstWindow = new notificationClaimStore_1.NotificationClaimStore(rootPath);
        const secondWindow = new notificationClaimStore_1.NotificationClaimStore(rootPath);
        strict_1.default.equal(firstWindow.claim("codex:session:turn"), true);
        strict_1.default.equal(secondWindow.claim("codex:session:turn"), false);
        strict_1.default.equal(secondWindow.claim("codex:session:another-turn"), true);
    }
    finally {
        fs.rmSync(rootPath, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("desktop notification activation accepts Windows click variants", () => {
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)("activate"), true);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)("clicked"), true);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)(undefined, "activated"), true);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)("dismissed", "打开 VS Code"), true);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)(undefined, undefined, "2026-08-20T01:00:00Z"), true);
});
(0, node_test_1.default)("desktop notification activation rejects dismissals and timeouts", () => {
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)(), false);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)(""), false);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)("timeout"), false);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)("timedout", "dismissed"), false);
    strict_1.default.equal((0, core_1.isDesktopNotificationActivation)("hidden"), false);
});
(0, node_test_1.default)("terminal command filtering defaults to Python commands", () => {
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("python train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("python3 train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("python3.12 train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("py -3 train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("pythonw train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("/opt/conda/envs/mocov3/bin/python -u /work/train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("/opt/conda/envs/mocov3/bin/python -u /work/extract.py \\\n" +
        "  --input-parquet /work/train.parquet \\\n" +
        "  --workers 16"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("cd project && /opt/conda/bin/python train.py"), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("echo python"), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("npm run build"), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("git status"), false);
});
(0, node_test_1.default)("terminal command filtering ignores common shell commands in all-command mode", () => {
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("ls -la", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("ll", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("pwd", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("/usr/bin/ls -la", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("sudo ls", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("ls && pwd", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), false);
    strict_1.default.equal(core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS.includes("ls"), true);
});
(0, node_test_1.default)("terminal command filtering can restore all-command mode", () => {
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("npm run build", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("git status", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("sudo npm test", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("APP_ENV=test npm test", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("cd project && npm test", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("ls && npm test", core_1.DEFAULT_IGNORED_TERMINAL_COMMANDS, false), true);
});
(0, node_test_1.default)("terminal command filtering accepts a custom ignored-command list", () => {
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("python train.py", ["python"]), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("npm run build", ["npm"], false), false);
    strict_1.default.equal((0, core_1.shouldNotifyTerminalCommand)("npm run build", ["ls"], false), true);
});
(0, node_test_1.default)("subagent session metadata is filtered", () => {
    strict_1.default.equal((0, core_1.isChildSessionMeta)({ parent_thread_id: "parent" }), true);
    strict_1.default.equal((0, core_1.isChildSessionMeta)({ thread_source: "subagent" }), true);
    strict_1.default.equal((0, core_1.isChildSessionMeta)({ source: { subagent: { thread_spawn: {} } } }), true);
    strict_1.default.equal((0, core_1.isChildSessionMeta)({ source: "cli", cwd: "/tmp" }), false);
});
(0, node_test_1.default)("subagent classification survives inherited root metadata", () => {
    const childMeta = {
        id: "child-session",
        session_id: "root-session",
        thread_source: "subagent",
        parent_thread_id: "root-session",
        source: { subagent: { thread_spawn: {} } },
    };
    const inheritedRootMeta = {
        id: "root-session",
        thread_source: "user",
        source: "vscode",
    };
    const detectedChild = (0, core_1.mergeChildSessionClassification)(false, childMeta);
    const detectedRoot = (0, core_1.mergeChildSessionClassification)(false, inheritedRootMeta);
    strict_1.default.equal(detectedChild, true);
    strict_1.default.equal((0, core_1.mergeChildSessionClassification)(detectedChild, inheritedRootMeta), true);
    strict_1.default.equal(detectedRoot, false);
    strict_1.default.equal((0, core_1.mergeChildSessionClassification)(detectedRoot, childMeta), true);
});
(0, node_test_1.default)("workspace matching treats Windows and WSL mount paths as equivalent", () => {
    strict_1.default.equal((0, core_1.normalizeWorkspacePath)("F:\\others\\vscode-Plugin\\Notifyer"), "f:/others/vscode-plugin/notifyer");
    strict_1.default.equal((0, core_1.normalizeWorkspacePath)("/mnt/f/others/vscode-Plugin/Notifyer"), "f:/others/vscode-plugin/notifyer");
    strict_1.default.equal((0, core_1.workspacePathsOverlap)("F:\\others\\vscode-Plugin\\Notifyer", "/mnt/f/others/vscode-plugin"), true);
    strict_1.default.equal((0, core_1.workspacePathsOverlap)("/srv/project-a", "/srv/project-b"), false);
});
(0, node_test_1.default)("Claude main-turn completion detection ignores sidechains and synthetic API errors", () => {
    strict_1.default.equal((0, core_1.isClaudeMainTaskCompletion)({
        type: "assistant", isApiErrorMessage: true, message: { stop_reason: "end_turn" },
    }), false);
    strict_1.default.equal((0, core_1.isClaudeMainTaskCompletion)({
        type: "assistant",
        isSidechain: false,
        message: { stop_reason: "end_turn" },
    }), true);
    strict_1.default.equal((0, core_1.isClaudeMainTaskCompletion)({
        type: "assistant",
        isSidechain: true,
        message: { stop_reason: "end_turn" },
    }), false);
    strict_1.default.equal((0, core_1.isClaudeMainTaskCompletion)({
        type: "assistant",
        isSidechain: false,
        message: { stop_reason: "tool_use" },
    }), false);
});
