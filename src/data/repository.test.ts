import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/open";
import { migrate } from "../storage/migrations";
import type { Sql } from "../storage/sql";
import { Repository } from "./repository";
import { ValidationError } from "../domain/types";

let sql: Sql;
let repo: Repository;
let time: Date;

beforeEach(async () => {
  sql = await openDatabase(null);
  migrate(sql);
  time = new Date("2026-11-10T09:00:00Z");
  repo = new Repository(sql, { now: () => time });
});

function seeded() {
  repo.seedIfEmpty();
  const board = repo.listBoards()[0];
  const [todo, doing, done] = repo.listColumns(board.id);
  return { board, todo, doing, done };
}

const positions = (columnId: string) => repo.listTasksInColumn(columnId).map((t) => [t.title, t.position]);

describe("seeding (AC1.2)", () => {
  it("creates My board with To do / Doing / Done, only Done being a done column", () => {
    expect(repo.seedIfEmpty()).toBe(true);
    const boards = repo.listBoards();
    expect(boards.map((b) => b.name)).toEqual(["My board"]);
    const cols = repo.listColumns(boards[0].id);
    expect(cols.map((c) => [c.name, c.position, c.isDoneColumn])).toEqual([
      ["To do", 0, false],
      ["Doing", 1, false],
      ["Done", 2, true],
    ]);
  });

  it("does nothing when a board already exists", () => {
    repo.createBoard("Work");
    expect(repo.seedIfEmpty()).toBe(false);
    expect(repo.listBoards().map((b) => b.name)).toEqual(["Work"]);
  });
});

describe("creating tasks (AC1.3)", () => {
  it("rejects a blank title", () => {
    const { board, todo } = seeded();
    expect(() => repo.createTask({ boardId: board.id, columnId: todo.id, title: "   " })).toThrow(ValidationError);
    expect(repo.listTasks(board.id)).toEqual([]);
  });

  it("gives a valid task an id, timestamps, a trimmed title and the last position", () => {
    const { board, todo } = seeded();
    const a = repo.createTask({ boardId: board.id, columnId: todo.id, title: " First " });
    const b = repo.createTask({ boardId: board.id, columnId: todo.id, title: "Second" });
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    expect(a.title).toBe("First");
    expect(a.createdAt).toBe(time.toISOString());
    expect(a.updatedAt).toBe(time.toISOString());
    expect([a.position, b.position]).toEqual([0, 1]);
    expect(a.startDate).toBeNull();
    expect(a.description).toBe("");
  });

  it("rejects a column from another board", () => {
    const { board } = seeded();
    const other = repo.createBoard("Other");
    const otherCol = repo.listColumns(other.id)[0];
    expect(() => repo.createTask({ boardId: board.id, columnId: otherCol.id, title: "x" })).toThrow(ValidationError);
  });
});

describe("updating tasks (AC1.4)", () => {
  it("updates fields and refreshes updatedAt", () => {
    const { board, todo } = seeded();
    const t = repo.createTask({ boardId: board.id, columnId: todo.id, title: "A" });
    time = new Date("2026-11-11T10:00:00Z");
    const u = repo.updateTask(t.id, { title: "B", description: "notes", deadline: "2026-11-20" });
    expect([u.title, u.description, u.deadline]).toEqual(["B", "notes", "2026-11-20"]);
    expect(u.updatedAt).toBe(time.toISOString());
    expect(u.createdAt).toBe(t.createdAt);
  });

  it("R2: end before start is rejected; any single date is fine", () => {
    const { board, todo } = seeded();
    const t = repo.createTask({ boardId: board.id, columnId: todo.id, title: "A" });
    expect(() => repo.updateTask(t.id, { startDate: "2026-11-10", endDate: "2026-11-09" })).toThrow(/End date/);
    expect(repo.updateTask(t.id, { endDate: "2026-11-09" }).endDate).toBe("2026-11-09");
    expect(() => repo.updateTask(t.id, { startDate: "2026-11-10" })).toThrow(/End date/);
    expect(repo.updateTask(t.id, { startDate: "2026-11-09" }).startDate).toBe("2026-11-09");
    // a deadline may be anywhere, even before start
    expect(repo.updateTask(t.id, { deadline: "2026-01-01" }).deadline).toBe("2026-01-01");
  });

  it("rejects invalid dates and allows clearing them", () => {
    const { board, todo } = seeded();
    const t = repo.createTask({ boardId: board.id, columnId: todo.id, title: "A", deadline: "2026-11-20" });
    expect(() => repo.updateTask(t.id, { deadline: "2026-02-30" })).toThrow(ValidationError);
    expect(repo.updateTask(t.id, { deadline: null }).deadline).toBeNull();
    expect(repo.updateTask(t.id, { deadline: "" }).deadline).toBeNull();
  });

  it("R3: a milestone from another board is rejected", () => {
    const { board, todo } = seeded();
    const other = repo.createBoard("Other");
    sql.run(
      "INSERT INTO milestone (id, board_id, title, date, created_at, updated_at) VALUES ('m1', ?, 'M', '2026-12-01', 'x', 'x')",
      [other.id],
    );
    const t = repo.createTask({ boardId: board.id, columnId: todo.id, title: "A" });
    expect(() => repo.updateTask(t.id, { milestoneId: "m1" })).toThrow(ValidationError);
  });
});

describe("moving tasks (R6)", () => {
  it("moves between columns and keeps positions gap-free", () => {
    const { board, todo, doing } = seeded();
    const [a, b, c] = ["A", "B", "C"].map((title) => repo.createTask({ boardId: board.id, columnId: todo.id, title }));
    repo.createTask({ boardId: board.id, columnId: doing.id, title: "X" });
    repo.moveTask(b.id, doing.id, 0);
    expect(positions(todo.id)).toEqual([["A", 0], ["C", 1]]);
    expect(positions(doing.id)).toEqual([["B", 0], ["X", 1]]);
    repo.moveTask(a.id, doing.id, 99);
    expect(positions(doing.id)).toEqual([["B", 0], ["X", 1], ["A", 2]]);
    expect(positions(todo.id)).toEqual([["C", 0]]);
    void c;
  });

  it("reorders within a column", () => {
    const { board, todo } = seeded();
    const [a] = ["A", "B", "C"].map((title) => repo.createTask({ boardId: board.id, columnId: todo.id, title }));
    repo.moveTask(a.id, todo.id, 2);
    expect(positions(todo.id)).toEqual([["B", 0], ["C", 1], ["A", 2]]);
    repo.moveTask(a.id, todo.id, 0);
    expect(positions(todo.id)).toEqual([["A", 0], ["B", 1], ["C", 2]]);
  });
});

describe("deleting tasks (AC1.5)", () => {
  it("removes the task and its label links, and undo restores both exactly", () => {
    const { board, todo } = seeded();
    const [a, b, c] = ["A", "B", "C"].map((title) => repo.createTask({ boardId: board.id, columnId: todo.id, title }));
    sql.run("INSERT INTO label (id, board_id, name, color) VALUES ('l1', ?, 'bug', 'red'), ('l2', ?, 'ui', 'blue')", [
      board.id,
      board.id,
    ]);
    sql.run("INSERT INTO task_label (task_id, label_id) VALUES (?, 'l1'), (?, 'l2')", [b.id, b.id]);
    const before = repo.getTask(b.id);

    const deleted = repo.deleteTask(b.id);
    expect(repo.getTask(b.id)).toBeUndefined();
    expect(sql.all("SELECT * FROM task_label")).toEqual([]);
    expect(positions(todo.id)).toEqual([["A", 0], ["C", 1]]);

    repo.restore(deleted);
    expect(repo.getTask(b.id)).toEqual(before);
    expect(repo.taskLabelIds(b.id)).toEqual(["l1", "l2"]);
    expect(positions(todo.id)).toEqual([["A", 0], ["B", 1], ["C", 2]]);
    void a;
    void c;
  });
});
