import { describe, expect, it } from "vitest";
import { plannedSpan, tasksForToday } from "./today";
import type { Board, Column, Task } from "./types";

const board = (id: string, position = 0): Board => ({ id, name: id, position, createdAt: "", updatedAt: "" });
const column = (id: string, boardId: string, isDoneColumn = false): Column => ({
  id,
  boardId,
  name: id,
  position: 0,
  isDoneColumn,
});
const task = (id: string, over: Partial<Task>): Task => ({
  id,
  boardId: "b1",
  columnId: "todo",
  title: id,
  description: "",
  startDate: null,
  endDate: null,
  deadline: null,
  milestoneId: null,
  position: 0,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const TODAY = "2026-11-11";
const columns = [column("todo", "b1"), column("done", "b1", true), column("todo2", "b2")];

const ids = (tasks: Task[], boards = [board("b1")]) =>
  tasksForToday({ boards, tasks, columns, today: TODAY }).map((s) => [s.board.id, s.tasks.map((t) => t.task.id)]);

describe("plannedSpan", () => {
  it("uses the single planned date for both ends", () => {
    expect(plannedSpan(task("a", { startDate: "2026-11-11" }))).toEqual({ start: "2026-11-11", end: "2026-11-11" });
    expect(plannedSpan(task("a", { endDate: "2026-11-12" }))).toEqual({ start: "2026-11-12", end: "2026-11-12" });
  });
  it("is null without planned dates, even with a deadline", () => {
    expect(plannedSpan(task("a", { deadline: TODAY }))).toBeNull();
  });
});

describe("tasksForToday", () => {
  it("includes tasks whose span covers today, inclusive at both ends", () => {
    const tasks = [
      task("starts-today", { startDate: TODAY, endDate: "2026-11-20" }),
      task("ends-today", { startDate: "2026-11-01", endDate: TODAY }),
      task("spans", { startDate: "2026-11-01", endDate: "2026-11-30" }),
      task("single-day", { startDate: TODAY }),
    ];
    expect(ids(tasks)).toEqual([["b1", ["ends-today", "single-day", "starts-today", "spans"]]]);
  });

  it("leaves out tasks before or after today, undated, and deadline-only tasks", () => {
    const tasks = [
      task("past", { startDate: "2026-11-01", endDate: "2026-11-10" }),
      task("future", { startDate: "2026-11-12", endDate: "2026-11-20" }),
      task("undated", {}),
      task("deadline-only", { deadline: TODAY }),
    ];
    expect(ids(tasks)).toEqual([]);
  });

  it("leaves out done tasks", () => {
    expect(ids([task("finished", { columnId: "done", startDate: TODAY })])).toEqual([]);
  });

  it("groups by board in the given board order and drops empty boards", () => {
    const boards = [board("b2", 0), board("b1", 1), board("b3", 2)];
    const tasks = [
      task("one", { startDate: TODAY }),
      task("two", { boardId: "b2", columnId: "todo2", startDate: TODAY }),
    ];
    expect(ids(tasks, boards)).toEqual([
      ["b2", ["two"]],
      ["b1", ["one"]],
    ]);
  });
});
