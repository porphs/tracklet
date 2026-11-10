import { describe, expect, it } from "vitest";
import { openDatabase } from "./open";
import { LATEST_VERSION, MIGRATIONS, NewerDatabaseError, currentVersion, migrate, pendingMigrations } from "./migrations";

describe("migrations", () => {
  it("AC1.1: a fresh database migrates to the latest version", async () => {
    const sql = await openDatabase(null);
    expect(currentVersion(sql)).toBe(0);
    expect(migrate(sql)).toBe(LATEST_VERSION);
    expect(currentVersion(sql)).toBe(LATEST_VERSION);
    expect(pendingMigrations(sql)).toEqual([]);
    const tables = sql.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
    expect(tables.map((t) => t.name)).toEqual(
      expect.arrayContaining(["board", "board_column", "label", "milestone", "setting", "task", "task_label"]),
    );
  });

  it("migrating twice is a no-op", async () => {
    const sql = await openDatabase(null);
    migrate(sql);
    expect(migrate(sql)).toBe(LATEST_VERSION);
  });

  it("AC1.6: a database newer than the app is refused and left unchanged", async () => {
    const sql = await openDatabase(null);
    migrate(sql);
    sql.run("UPDATE schema_version SET version = ?", [LATEST_VERSION + 1]);
    const before = sql.export();
    expect(() => migrate(sql)).toThrow(NewerDatabaseError);
    expect(sql.export()).toEqual(before);
  });

  it("AC1.7: a failing migration rolls back, leaving version and data unchanged", async () => {
    const sql = await openDatabase(null);
    migrate(sql);
    sql.run("INSERT INTO setting (key, value) VALUES ('k', 'v')");
    const broken = [
      ...MIGRATIONS,
      { version: LATEST_VERSION + 1, up: "CREATE TABLE extra (x INTEGER); INSERT INTO nope VALUES (1);" },
    ];
    expect(() => migrate(sql, broken)).toThrow();
    expect(currentVersion(sql)).toBe(LATEST_VERSION);
    expect(sql.get("SELECT name FROM sqlite_master WHERE name = 'extra'")).toBeUndefined();
    expect(sql.get<{ value: string }>("SELECT value FROM setting WHERE key = 'k'")?.value).toBe("v");
  });

  it("data survives export and reopen, with foreign keys still enforced", async () => {
    const sql = await openDatabase(null);
    migrate(sql);
    sql.run("INSERT INTO setting (key, value) VALUES ('a', '1')");
    const reopened = await openDatabase(sql.export());
    expect(reopened.get<{ value: string }>("SELECT value FROM setting WHERE key = 'a'")?.value).toBe("1");
    expect(() =>
      reopened.run(
        "INSERT INTO board_column (id, board_id, name, position) VALUES ('c', 'missing-board', 'x', 0)",
      ),
    ).toThrow(/FOREIGN KEY/);
  });
});
