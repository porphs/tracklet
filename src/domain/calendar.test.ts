import { describe, expect, it } from "vitest";
import { addMonths, calendarItems, monthGrid } from "./calendar";
import type { Label, Milestone, Task } from "./types";

describe("AC4.1: month grid", () => {
  const check = (grid: string[][]) => {
    for (const week of grid) expect(week).toHaveLength(7);
    // every row starts on a Monday
    for (const week of grid) expect(new Date(`${week[0]}T12:00:00Z`).getUTCDay()).toBe(1);
  };

  it("a month starting on Monday (June 2026) has no leading days", () => {
    const g = monthGrid("2026-06-15");
    check(g);
    expect(g[0][0]).toBe("2026-06-01");
    expect(g[g.length - 1][6]).toBe("2026-07-05");
    expect(g).toHaveLength(5);
  });

  it("a month starting on Sunday (November 2026) has 6 leading days", () => {
    const g = monthGrid("2026-11-10");
    check(g);
    expect(g[0]).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
    expect(g[g.length - 1][6]).toBe("2026-12-06");
    expect(g).toHaveLength(6);
  });

  it("February in a leap year (2028) includes the 29th", () => {
    const g = monthGrid("2028-02-01");
    check(g);
    const days = g.flat();
    expect(days).toContain("2028-02-29");
    expect(days.filter((d) => d.startsWith("2028-02"))).toHaveLength(29);
    expect(g[0][0]).toBe("2028-01-31");
  });

  it("covers every day of the month exactly once", () => {
    for (const m of ["2026-01-01", "2026-02-01", "2026-12-01", "2027-03-01"]) {
      const days = monthGrid(m).flat();
      expect(new Set(days).size).toBe(days.length);
    }
  });

  it("addMonths crosses years", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
});

const task = (id: string, over: Partial<Task>): Task => ({
  id,
  boardId: "b1",
  columnId: "c1",
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

const ms = (id: string, date: string, boardId = "b1"): Milestone => ({
  id,
  boardId,
  title: id,
  description: "",
  date,
  isReached: false,
  createdAt: "",
  updatedAt: "",
});

describe("AC4.2: items for a day", () => {
  const label: Label = { id: "l", boardId: "b1", name: "bug", color: "red" };
  const tasks = [
    task("deadline-20", { deadline: "2026-11-20" }),
    task("start-end-only", { startDate: "2026-11-20", endDate: "2026-11-20" }),
    task("labelled-20", { deadline: "2026-11-20" }),
    task("done-20", { deadline: "2026-11-20", columnId: "done" }),
    task("other-day", { deadline: "2026-11-21" }),
  ];
  const input = {
    tasks,
    milestones: [ms("m-20", "2026-11-20")],
    doneColumnIds: new Set(["done"]),
    labelsByTask: new Map([["labelled-20", [label]]]),
    labelFilter: null as string | null,
  };

  it("includes deadlines and milestones, never start/end dates; milestones first", () => {
    const day = calendarItems(input).get("2026-11-20")!;
    expect(day.map((i) => (i.kind === "task" ? i.task.id : i.milestone.id))).toEqual([
      "m-20",
      "deadline-20",
      "labelled-20",
      "done-20",
    ]);
    expect(day.find((i) => i.kind === "task" && i.task.id === "done-20")).toMatchObject({ done: true });
  });

  it("label filter keeps matching tasks and all milestones", () => {
    const day = calendarItems({ ...input, labelFilter: "BUG" }).get("2026-11-20")!;
    expect(day.map((i) => (i.kind === "task" ? i.task.id : i.milestone.id))).toEqual(["m-20", "labelled-20"]);
  });

  it("scope is the caller's choice of tasks/milestones; a range trims the result", () => {
    const res = calendarItems({ ...input, from: "2026-11-21", to: "2026-11-30" });
    expect([...res.keys()]).toEqual(["2026-11-21"]);
  });
});
