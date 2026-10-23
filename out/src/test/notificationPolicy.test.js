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
const notificationPolicy_1 = require("../notificationPolicy");
(0, node_test_1.default)("desktop switch mutes desktop-only notifications and preserves explicitly configured VS Code notices", () => {
    strict_1.default.deepEqual((0, notificationPolicy_1.notificationChannels)("Desktop", false), { desktop: false, editor: false });
    strict_1.default.deepEqual((0, notificationPolicy_1.notificationChannels)("Both", false), { desktop: false, editor: true });
    strict_1.default.deepEqual((0, notificationPolicy_1.notificationChannels)("VS Code", false), { desktop: false, editor: true });
    strict_1.default.deepEqual((0, notificationPolicy_1.notificationChannels)("Both", true), { desktop: true, editor: true });
    strict_1.default.deepEqual((0, notificationPolicy_1.notificationChannels)("Desktop", true), { desktop: true, editor: false });
});
(0, node_test_1.default)("shared desktop preference defaults off and subsequent events immediately observe an explicit toggle", () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "notifyer-policy-"));
    const file = path.join(folder, "notification-policy.json");
    try {
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(undefined), false);
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(file), false);
        fs.writeFileSync(file, JSON.stringify({ desktopEnabled: false }));
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(file), false);
        fs.writeFileSync(file, JSON.stringify({ desktopEnabled: true }));
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(file), true);
        fs.writeFileSync(file, JSON.stringify({}));
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(file), false);
        fs.writeFileSync(file, JSON.stringify({ desktopEnabled: "true" }));
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(file), false);
        fs.writeFileSync(file, "invalid JSON");
        strict_1.default.equal((0, notificationPolicy_1.readDesktopNotificationPolicy)(file), false);
    }
    finally {
        fs.rmSync(folder, { recursive: true, force: true });
    }
});
