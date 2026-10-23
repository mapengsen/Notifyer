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
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationClaimStore = void 0;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const DEFAULT_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CLAIM_FILE_PATTERN = /^[a-f0-9]{64}\.claim$/;
/**
 * Coordinates notification delivery across VS Code windows.
 *
 * Each event is represented by an atomically created file in extension global
 * storage. `wx` guarantees that only one extension host can claim an event,
 * even when several VS Code windows discover it at the same time.
 */
class NotificationClaimStore {
    rootPath;
    claimTtlMs;
    constructor(rootPath, claimTtlMs = DEFAULT_CLAIM_TTL_MS) {
        this.rootPath = rootPath;
        this.claimTtlMs = claimTtlMs;
    }
    claim(key) {
        fs.mkdirSync(this.rootPath, { recursive: true });
        const digest = (0, node_crypto_1.createHash)("sha256").update(key).digest("hex");
        const claimPath = path.join(this.rootPath, `${digest}.claim`);
        let descriptor;
        try {
            descriptor = fs.openSync(claimPath, "wx");
            fs.writeFileSync(descriptor, `${Date.now()}\n`, "utf8");
            return true;
        }
        catch (error) {
            if (isFileExistsError(error))
                return false;
            throw error;
        }
        finally {
            if (descriptor !== undefined)
                fs.closeSync(descriptor);
        }
    }
    pruneExpiredClaims(now = Date.now()) {
        fs.mkdirSync(this.rootPath, { recursive: true });
        const expiresBefore = now - this.claimTtlMs;
        for (const entry of fs.readdirSync(this.rootPath, { withFileTypes: true })) {
            if (!entry.isFile() || !CLAIM_FILE_PATTERN.test(entry.name))
                continue;
            const claimPath = path.join(this.rootPath, entry.name);
            try {
                if (fs.statSync(claimPath).mtimeMs < expiresBefore)
                    fs.unlinkSync(claimPath);
            }
            catch (error) {
                if (!isFileMissingError(error))
                    throw error;
            }
        }
    }
}
exports.NotificationClaimStore = NotificationClaimStore;
function isFileExistsError(error) {
    return error instanceof Error && "code" in error && error.code === "EEXIST";
}
function isFileMissingError(error) {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}
