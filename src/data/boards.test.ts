import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/open";
import { migrate } from "../storage/migrations";
import type { Sql } from "../storage/sql";
import { Repository } from "./repository";
import { ValidationError } from "../domain/types";

let sql: Sql;
let repo: Repository;

beforeEach(async () => {
  sql = await openDatabase(null);
  migrate(sql);
  repo = new Repository(sql, { now: () => new Date("2026-11-10T09:00:00Z") });
});

const boardOrder = () => repo.listBoards().map((b) => [b.name, b.position]);
const colOrder = (boardId: string) => repo.listColumns(boardId).map((c) => [c.name, c.position]);

describe("boards", () => {
  it("creates, renames and rejects blank names", () => {
    const b = repo.createBoard("Work");
    expect(repo.renameBoard(b.id, "  Job ").name).toBe("Job");
    expect(() => repo.renameBoard(b.id, " ")).toThrow(ValidationError);
    expect(() => repo.createBoard("")).toThrow(ValidationError);
  });

  it("AC2.2: reordering boards keeps positions gap-free", () => {
    const [a, , c] = ["A", "B", "C"].map((n) => repo.createBoard(n));
    repo.moveBoard(c.id, 0);
    expect(boardOrder()).toEqual([["C", 0], ["A", 1], ["B", 2]]);
    repo.moveBoard(a.id, 10);
    expect(boardOrder()).toEqual([["C", 0], ["B", 1], ["A", 2]]);
  });

  it("AC2.4: deleting a board removes everything on it and nothing else", () => {
    const keep = repo.createBoard("Keep");
    const gone = repo.createBoard("Gone");
    for (const b of [keep, gone]) {
      const col = repo.listColumns(b.id)[0];
      const t = repo.createTask({ boardId: b.id, columnId: col.id, title: `task on ${b.name}` });
      sql.run("INSERT INTO label (id, board_id, name, color) VALUES (?, ?, 'l', 'red')", [`l-${b.id}`, b.id]);
      sql.run("INSERT INTO task_label VALUES (?, ?)", [t.id, `l-${b.id}`]);
      sql.run(
        "INSERT INTO milestone (id, board_id, title, date, created_at, updated_at) VALUES (?, ?, 'm', '2026-12-01', 'x', 'x')",
        [`m-${b.id}`, b.id],
      );
    }
    repo.deleteBoard(gone.id);
    const count = (table: string) => sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)!.n;
    expect(boardOrder()).toEqual([["Keep", 0]]);
    expect(count("board_column")).toBe(3);
    expect(count("task")).toBe(1);
    expect(count("label")).toBe(1);
    expect(count("task_label")).toBe(1);
    expect(count("milestone")).toBe(1);
    expect(repo.listTasks(keep.id).map((t) => t.title)).toEqual(["task on Keep"]);
  });
});

describe("columns", () => {
  it("adds at the end, renames, toggles done", () => {
    const b = repo.createBoard("B");
    const c = repo.addColumn(b.id, "Review");
    expect(colOrder(b.id)).toEqual([["To do", 0], ["Doing", 1], ["Done", 2], ["Review", 3]]);
    expect(repo.renameColumn(c.id, "QA").name).toBe("QA");
    expect(repo.setDoneColumn(c.id, true).isDoneColumn).toBe(true);
    expect(repo.setDoneColumn(c.id, false).isDoneColumn).toBe(false);
  });

  it("AC2.2: reordering columns keeps positions gap-free", () => {
    const b = repo.createBoard("B");
    const [todo, , done] = repo.listColumns(b.id);
    repo.moveColumn(done.id, 0);
    expect(colOrder(b.id)).toEqual([["Done", 0], ["To do", 1], ["Doing", 2]]);
    repo.moveColumn(todo.id, 2);
    expect(colOrder(b.id)).toEqual([["Done", 0], ["Doing", 1], ["To do", 2]]);
  });

  it("AC2.3: a non-empty column cannot be deleted; an empty one closes the gap", () => {
    const b = repo.createBoard("B");
    const [todo, doing] = repo.listColumns(b.id);
    repo.createTask({ boardId: b.id, columnId: todo.id, title: "x" });
    expect(() => repo.deleteColumn(todo.id)).toThrow(/Move the 1 task out/);
    repo.deleteColumn(doing.id);
    expect(colOrder(b.id)).toEqual([["To do", 0], ["Done", 1]]);
  });
});

describe("AC2.1: moving tasks to a requested index", () => {
  it("lands at the index in the target column with gap-free positions in both", () => {
    const b = repo.createBoard("B");
    const [todo, doing] = repo.listColumns(b.id);
    const ts = ["A", "B", "C"].map((title) => repo.createTask({ boardId: b.id, columnId: todo.id, title }));
    ["X", "Y"].forEach((title) => repo.createTask({ boardId: b.id, columnId: doing.id, title }));
    repo.moveTask(ts[0].id, doing.id, 1);
    const order = (colId: string) => repo.listTasksInColumn(colId).map((t) => [t.title, t.position]);
    expect(order(doing.id)).toEqual([["X", 0], ["A", 1], ["Y", 2]]);
    expect(order(todo.id)).toEqual([["B", 0], ["C", 1]]);
  });

  it("rejects moving to a column on another board", () => {
    const b1 = repo.createBoard("B1");
    const b2 = repo.createBoard("B2");
    const t = repo.createTask({ boardId: b1.id, columnId: repo.listColumns(b1.id)[0].id, title: "x" });
    expect(() => repo.moveTask(t.id, repo.listColumns(b2.id)[0].id, 0)).toThrow(ValidationError);
  });
});
