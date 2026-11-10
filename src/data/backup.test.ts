import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/open";
import { migrate } from "../storage/migrations";
import type { Sql } from "../storage/sql";
import { Repository } from "./repository";
import { FORMAT_VERSION, ImportError, applyImport, exportData, parseImport, serializeExport, upgradeToCurrent } from "./backup";

async function freshDb(): Promise<Sql> {
  const sql = await openDatabase(null);
  migrate(sql);
  return sql;
}

let sql: Sql;
let repo: Repository;
const now = new Date("2026-11-10T09:00:00Z");

/** A database with a bit of everything in it. */
async function populated(): Promise<Sql> {
  const db = await freshDb();
  const r = new Repository(db, { now: () => now });
  const work = r.createBoard("Work");
  const home = r.createBoard("Home");
  const [todo, , done] = r.listColumns(work.id);
  const m = r.createMilestone(work.id, "v1", "2026-12-01", "ship it");
  r.updateMilestone(m.id, { isReached: true });
  const bug = r.createLabel(work.id, "bug", "red");
  r.createLabel(home.id, "bug", "blue");
  const t1 = r.createTask({ boardId: work.id, columnId: todo.id, title: "A", deadline: "2026-11-20", milestoneId: m.id });
  r.createTask({ boardId: work.id, columnId: todo.id, title: "B", startDate: "2026-11-01", endDate: "2026-11-03", description: "multi\nline “quotes”" });
  r.createTask({ boardId: work.id, columnId: done.id, title: "C" });
  r.createTask({ boardId: home.id, columnId: r.listColumns(home.id)[0].id, title: "D" });
  r.setTaskLabel(t1.id, bug.id, true);
  r.setNearWindow(5);
  r.setSetting("window_bounds", "{\"w\":1}");
  return db;
}

beforeEach(async () => {
  sql = await populated();
  repo = new Repository(sql, { now: () => now });
});

const stripTime = (json: string) => {
  const o = JSON.parse(json);
  delete o.exportedAt;
  return o;
};

describe("AC6.1: export round-trip", () => {
  it("export → import into empty → export gives identical JSON (ignoring exportedAt)", async () => {
    const first = serializeExport(sql, now);
    const target = await freshDb();
    applyImport(target, parseImport(first));
    const second = serializeExport(target, new Date("2027-01-01T00:00:00Z"));
    expect(stripTime(second)).toEqual(stripTime(first));
  });

  it("includes format version, all tables and settings, but not the window size", () => {
    const file = JSON.parse(serializeExport(sql, now));
    expect(file).toMatchObject({ app: "tracklet", formatVersion: FORMAT_VERSION, exportedAt: now.toISOString() });
    expect(file.data.boards).toHaveLength(2);
    expect(file.data.tasks).toHaveLength(4);
    expect(file.data.taskLabels).toHaveLength(1);
    expect(file.data.settings).toEqual({ near_window_days: "5" });
  });
});

describe("AC6.2: rejected imports change nothing", () => {
  const valid = () => JSON.parse(serializeExport(sql, now));
  const cases: [string, () => string, RegExp][] = [
    ["invalid JSON", () => "{not json", /not valid JSON/],
    ["not an export", () => JSON.stringify({ hello: 1 }), /not a Tracklet export/],
    ["missing formatVersion", () => { const f = valid(); delete f.formatVersion; return JSON.stringify(f); }, /format version/],
    ["newer formatVersion", () => JSON.stringify({ ...valid(), formatVersion: FORMAT_VERSION + 1 }), /newer version/],
    ["task → missing column", () => { const f = valid(); f.data.tasks[0].columnId = "nope"; return JSON.stringify(f); }, /column/],
    ["task → column on another board", () => {
      const f = valid();
      const homeCol = f.data.columns.find((c: any) => c.boardId !== f.data.tasks[0].boardId);
      f.data.tasks[0].columnId = homeCol.id;
      return JSON.stringify(f);
    }, /column/],
    ["task → missing milestone", () => { const f = valid(); f.data.tasks.find((t: any) => t.milestoneId).milestoneId = "gone"; return JSON.stringify(f); }, /milestone/],
    ["link → label on another board", () => {
      const f = valid();
      const t = f.data.tasks.find((t: any) => t.title === "D");
      f.data.taskLabels[0].taskId = t.id;
      return JSON.stringify(f);
    }, /label/],
    ["duplicate id", () => { const f = valid(); f.data.tasks[1].id = f.data.tasks[0].id; return JSON.stringify(f); }, /more than once/],
    ["bad date", () => { const f = valid(); f.data.tasks[0].deadline = "2026-02-31"; return JSON.stringify(f); }, /date/],
    ["milestone without date", () => { const f = valid(); f.data.milestones[0].date = null; return JSON.stringify(f); }, /needs a date/],
    ["empty title", () => { const f = valid(); f.data.tasks[0].title = " "; return JSON.stringify(f); }, /empty/],
    ["unknown colour", () => { const f = valid(); f.data.labels[0].color = "pink"; return JSON.stringify(f); }, /colour/],
  ];
  for (const [name, make, msg] of cases) {
    it(name, async () => {
      const target = await populated();
      const before = target.export();
      expect(() => applyImport(target, parseImport(make()))).toThrow(ImportError);
      expect(() => parseImport(make())).toThrow(msg);
      expect(target.export()).toEqual(before);
    });
  }
});

describe("AC6.3: valid import replaces everything", () => {
  it("nothing from before survives; the window size setting is kept", async () => {
    const other = await freshDb();
    const r2 = new Repository(other, { now: () => now });
    r2.createBoard("Only this");
    const text = serializeExport(other, now);
    applyImport(sql, parseImport(text));
    expect(repo.listBoards().map((b) => b.name)).toEqual(["Only this"]);
    expect(sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM task")!.n).toBe(0);
    expect(sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM label")!.n).toBe(0);
    expect(repo.nearWindow()).toBe(3);
    expect(repo.getSetting("window_bounds")).toBe("{\"w\":1}");
  });

  it("is all-or-nothing: a failure part-way leaves the old data", async () => {
    const data = parseImport(serializeExport(sql, now));
    // Sneak in something parseImport would have caught, so the insert fails mid-way.
    data.taskLabels.push({ taskId: "missing", labelId: "missing" });
    const before = sql.export();
    expect(() => applyImport(sql, data)).toThrow();
    expect(sql.export()).toEqual(before);
  });

  it("renumbers positions if the file has gaps (R6)", async () => {
    const f = JSON.parse(serializeExport(sql, now));
    f.data.tasks.forEach((t: any) => (t.position = t.position * 10 + 5));
    applyImport(sql, parseImport(JSON.stringify(f)));
    const board = repo.listBoards()[0];
    const col = repo.listColumns(board.id)[0];
    expect(repo.listTasksInColumn(col.id).map((t) => [t.title, t.position])).toEqual([["A", 0], ["B", 1]]);
  });
});

describe("AC6.4: format upgrades", () => {
  it("the current version passes through unchanged", () => {
    const d = exportData(sql);
    expect(upgradeToCurrent(FORMAT_VERSION, d)).toBe(d);
  });
});
