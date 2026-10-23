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
exports.ProviderStateReader = void 0;
const fs = __importStar(require("node:fs"));
/** Read only the requested namespaces. No provider database is ever modified. */
class ProviderStateReader {
    Database;
    constructor() {
        try {
            this.Database = require("node:sqlite").DatabaseSync;
        }
        catch { }
    }
    get supported() { return Boolean(this.Database); }
    read(file, keys) {
        if (!this.Database || !file || !fs.existsSync(file))
            return;
        const database = new this.Database(file, { readOnly: true });
        try {
            const query = database.prepare("SELECT value FROM ItemTable WHERE key = ? COLLATE NOCASE");
            const result = {};
            for (const key of keys) {
                const row = query.get(key);
                if (row?.value)
                    result[key] = JSON.parse(row.value);
            }
            return result;
        }
        finally {
            database.close();
        }
    }
}
exports.ProviderStateReader = ProviderStateReader;
