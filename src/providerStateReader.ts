import * as fs from "node:fs";

interface StateDatabase {
  prepare(sql: string): { get(...params: string[]): { value?: string } | undefined };
  close(): void;
}
type DatabaseConstructor = new (file: string, options: { readOnly: true }) => StateDatabase;

/** Read only the requested namespaces. No provider database is ever modified. */
export class ProviderStateReader {
  private readonly Database: DatabaseConstructor | undefined;
  public constructor() {
    try { this.Database = (require("node:sqlite") as { DatabaseSync: DatabaseConstructor }).DatabaseSync; } catch {}
  }
  public get supported(): boolean { return Boolean(this.Database); }
  public read(file: string | undefined, keys: readonly string[]): Record<string, unknown> | undefined {
    if (!this.Database || !file || !fs.existsSync(file)) return;
    const database = new this.Database(file, { readOnly: true });
    try {
      const query = database.prepare("SELECT value FROM ItemTable WHERE key = ? COLLATE NOCASE");
      const result: Record<string, unknown> = {};
      for (const key of keys) {
        const row = query.get(key);
        if (row?.value) result[key] = JSON.parse(row.value);
      }
      return result;
    } finally { database.close(); }
  }
}
