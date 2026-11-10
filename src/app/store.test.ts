import { describe, expect, it } from "vitest";
import { bootStore } from "./store";
import { memoryPersistence } from "../storage/persistence";
import { openDatabase } from "../storage/open";
import { LATEST_VERSION, NewerDatabaseError, migrate } from "../storage/migrations";

const clock = { now: () => new Date(2026, 10, 10, 9, 30, 0) };

describe("bootStore", () => {
  it("first launch: migrates, seeds My board, saves, and takes no backup", async () => {
    const p = memoryPersistence();
    const store = await bootStore(p, { clock });
    expect(store.repo.listBoards().map((b) => b.name)).toEqual(["My board"]);
    expect(p.saved).not.toBeNull();
    expect(p.backups.size).toBe(0);
  });

  it("AC1.8 (logic): data written through the store survives a relaunch", async () => {
    const p = memoryPersistence();
    const store = await bootStore(p, { clock });
    const board = store.repo.listBoards()[0];
    const col = store.repo.listColumns(board.id)[0];
    store.mutate((r) => r.createTask({ boardId: board.id, columnId: col.id, title: "Persist me" }));
    await store.flush();
    const again = await bootStore(p, { clock });
    expect(again.repo.listTasks(board.id).map((t) => t.title)).toEqual(["Persist me"]);
    expect(again.repo.listBoards()).toHaveLength(1);
  });

  it("takes a pre-migration backup when an existing database is behind", async () => {
    const old = await openDatabase(null);
    old.run("CREATE TABLE schema_version (version INTEGER NOT NULL)");
    old.run("INSERT INTO schema_version VALUES (0)");
    const p = memoryPersistence(old.export());
    await bootStore(p, { clock });
    expect([...p.backups.keys()]).toEqual([`tracklet-20261110-093000-pre-migration-v${LATEST_VERSION}.db`]);
  });

  it("AC1.6: refuses a newer database without saving or backing up", async () => {
    const db = await openDatabase(null);
    migrate(db);
    db.run("UPDATE schema_version SET version = 999");
    const bytes = db.export();
    const p = memoryPersistence(bytes);
    await expect(bootStore(p, { clock })).rejects.toBeInstanceOf(NewerDatabaseError);
    expect(p.saved).toEqual(bytes);
    expect(p.backups.size).toBe(0);
  });

  it("a failed mutation changes nothing and is not saved", async () => {
    const p = memoryPersistence();
    const store = await bootStore(p, { clock });
    const before = p.saved;
    const board = store.repo.listBoards()[0];
    const col = store.repo.listColumns(board.id)[0];
    expect(() => store.mutate((r) => r.createTask({ boardId: board.id, columnId: col.id, title: "" }))).toThrow();
    await store.flush();
    expect(p.saved).toBe(before);
  });
});
