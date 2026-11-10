import initSqlJs, { type SqlJsConfig, type SqlJsStatic } from "sql.js";
import { wrapDatabase, type Sql } from "./sql";

let engine: Promise<SqlJsStatic> | null = null;

/** Loads the sql.js engine once. In the browser pass `locateFile` so it finds the .wasm. */
export function loadEngine(config?: SqlJsConfig): Promise<SqlJsStatic> {
  engine ??= initSqlJs(config);
  return engine;
}

/** Opens a database from saved bytes, or a new empty one. Foreign keys are always on. */
export async function openDatabase(bytes: Uint8Array | null, config?: SqlJsConfig): Promise<Sql> {
  const SQL = await loadEngine(config);
  const db = bytes && bytes.length ? new SQL.Database(bytes) : new SQL.Database();
  db.run("PRAGMA foreign_keys = ON");
  return wrapDatabase(db);
}
