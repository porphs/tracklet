import type { Sql } from "./sql";

export interface Migration {
  version: number;
  up: string;
}

/** Forward-only, numbered migrations (ADR 0002). Never edit a shipped one: add a new one. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up: `
      CREATE TABLE board (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE board_column (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        is_done_column INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE milestone (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        date TEXT NOT NULL,
        is_reached INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE task (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        column_id TEXT NOT NULL REFERENCES board_column(id),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        start_date TEXT,
        end_date TEXT,
        deadline TEXT,
        milestone_id TEXT REFERENCES milestone(id) ON DELETE SET NULL,
        position INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE label (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES board(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        color TEXT NOT NULL
      );
      CREATE TABLE task_label (
        task_id TEXT NOT NULL REFERENCES task(id) ON DELETE CASCADE,
        label_id TEXT NOT NULL REFERENCES label(id) ON DELETE CASCADE,
        PRIMARY KEY (task_id, label_id)
      );
      CREATE TABLE setting (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE INDEX task_column_idx ON task(column_id, position);
      CREATE INDEX task_board_idx ON task(board_id);
      CREATE INDEX column_board_idx ON board_column(board_id, position);
    `,
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

export class NewerDatabaseError extends Error {
  constructor(public dbVersion: number, public appVersion: number) {
    super(
      `This data was saved by a newer version of Tracklet (schema ${dbVersion}; this app supports up to ${appVersion}). ` +
        `It was not opened, to avoid damaging it. Please use the newer app.`,
    );
    this.name = "NewerDatabaseError";
  }
}

export function currentVersion(sql: Sql): number {
  sql.run("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = sql.get<{ version: number }>("SELECT version FROM schema_version");
  return row?.version ?? 0;
}

/** Migrations still to run. Throws NewerDatabaseError if the DB is ahead of the app. */
export function pendingMigrations(sql: Sql, migrations: Migration[] = MIGRATIONS): Migration[] {
  const version = currentVersion(sql);
  const latest = migrations.length ? migrations[migrations.length - 1].version : 0;
  if (version > latest) throw new NewerDatabaseError(version, latest);
  return migrations.filter((m) => m.version > version);
}

/** Runs each pending migration in its own transaction. A failure rolls that step back and rethrows. */
export function migrate(sql: Sql, migrations: Migration[] = MIGRATIONS): number {
  const pending = pendingMigrations(sql, migrations);
  for (const m of pending) {
    sql.tx(() => {
      sql.run(m.up);
      sql.run("DELETE FROM schema_version");
      sql.run("INSERT INTO schema_version (version) VALUES (?)", [m.version]);
    });
  }
  return currentVersion(sql);
}
