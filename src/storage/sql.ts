import type { Database, SqlValue } from "sql.js";

export type Params = SqlValue[] | Record<string, SqlValue>;

/**
 * The only way the rest of the app talks to SQLite.
 * Everything is synchronous: sql.js runs in-process (ADR 0001).
 */
export interface Sql {
  run(sql: string, params?: Params): void;
  all<T>(sql: string, params?: Params): T[];
  get<T>(sql: string, params?: Params): T | undefined;
  /** Runs fn atomically. Nested calls become savepoints. */
  tx<T>(fn: () => T): T;
  /** Serialises the whole database to bytes (for saving to disk). */
  export(): Uint8Array;
}

export function wrapDatabase(db: Database): Sql {
  let depth = 0;

  const all = <T>(sql: string, params?: Params): T[] => {
    const stmt = db.prepare(sql);
    try {
      if (params) stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  };

  return {
    run(sql, params) {
      db.run(sql, params);
    },
    all,
    get(sql, params) {
      return all<any>(sql, params)[0];
    },
    tx(fn) {
      const name = `sp${depth}`;
      db.run(depth === 0 ? "BEGIN" : `SAVEPOINT ${name}`);
      depth++;
      try {
        const result = fn();
        depth--;
        db.run(depth === 0 ? "COMMIT" : `RELEASE ${name}`);
        return result;
      } catch (e) {
        depth--;
        db.run(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${name}; RELEASE ${name}`);
        throw e;
      }
    },
    export() {
      if (depth > 0) throw new Error("Cannot export inside a transaction");
      return db.export();
    },
  };
}
