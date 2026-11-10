import { describe, expect, it } from "vitest";
import {
  PX_PER_DAY,
  barGeometry,
  buildTimeline,
  dateToX,
  dayDelta,
  dragPlannedDates,
  ticks,
  visibleRange,
  xToDate,
  type Zoom,
} from "./timeline";
import type { Board, Label, Milestone, Task } from "./types";

const board = (id: string, position = 0): Board => ({ id, name: id, position, createdAt: "", updatedAt: "" });
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

const base = {
  doneColumnIds: new Set(["done"]),
  labelsByTask: new Map<string, Label[]>(),
  labelFilter: null as string | null,
};

describe("AC5.1: rows", () => {
  const tasks = [
    task("no-dates", {}),
    task("late-start", { startDate: "2026-11-20", endDate: "2026-11-22", milestoneId: "m2" }),
    task("early-start", { startDate: "2026-11-05", endDate: "2026-11-06", milestoneId: "m2" }),
    task("deadline-only", { deadline: "2026-11-12", milestoneId: "m1" }),
    task("loose-a", { deadline: "2026-11-30" }),
    task("loose-b", { startDate: "2026-11-01", columnId: "done" }),
    task("end-only", { endDate: "2026-11-15" }),
  ];
  const milestones = [ms("m2", "2026-11-25"), ms("m1", "2026-11-15"), ms("empty", "2026-12-01")];

  it("groups by milestone (by date) then No milestone; sorts by start, then deadline; drops undated", () => {
    const [section] = buildTimeline({ ...base, boards: [board("b1")], tasks, milestones });
    expect(section.groups.map((g) => [g.milestone?.id ?? "none", g.tasks.map((t) => t.task.id)])).toEqual([
      ["m1", ["deadline-only"]],
      ["m2", ["early-start", "late-start"]],
      ["empty", []],
      ["none", ["loose-b", "end-only", "loose-a"]],
    ]);
  });

  it("bars: start..end, one-day bar for a single planned date, none for deadline-only; done flag", () => {
    const [section] = buildTimeline({ ...base, boards: [board("b1")], tasks, milestones });
    const all = section.groups.flatMap((g) => g.tasks);
    const get = (id: string) => all.find((t) => t.task.id === id)!;
    expect(get("late-start").bar).toEqual({ start: "2026-11-20", end: "2026-11-22" });
    expect(get("end-only").bar).toEqual({ start: "2026-11-15", end: "2026-11-15" });
    expect(get("loose-b").bar).toEqual({ start: "2026-11-01", end: "2026-11-01" });
    expect(get("deadline-only").bar).toBeNull();
    expect(get("loose-b").done).toBe(true);
  });

  it("all-boards: one section per board in board order; label filter hides tasks but not milestones", () => {
    const label: Label = { id: "l", boardId: "b2", name: "x", color: "red" };
    const sections = buildTimeline({
      ...base,
      labelFilter: "x",
      labelsByTask: new Map([["t2", [label]]]),
      boards: [board("b1"), board("b2", 1)],
      tasks: [task("t1", { deadline: "2026-11-10" }), task("t2", { boardId: "b2", deadline: "2026-11-10" })],
      milestones: [ms("m1", "2026-11-15")],
    });
    expect(sections.map((s) => [s.board.id, s.groups.map((g) => [g.milestone?.id ?? "none", g.tasks.length])])).toEqual([
      ["b1", [["m1", 0]]],
      ["b2", [["none", 1]]],
    ]);
  });
});

describe("AC5.2: date ↔ x", () => {
  const range = { start: "2026-11-01", end: "2026-12-31" };
  for (const zoom of ["day", "week", "month"] as Zoom[]) {
    it(`maps correctly at ${zoom} zoom`, () => {
      const px = PX_PER_DAY[zoom];
      expect(dateToX("2026-11-01", range, zoom)).toBe(0);
      expect(dateToX("2026-11-11", range, zoom)).toBe(10 * px);
      expect(xToDate(10 * px + px / 2, range, zoom)).toBe("2026-11-11");
      // a 5-day bar, inclusive of its end day
      expect(barGeometry({ start: "2026-11-10", end: "2026-11-14" }, range, zoom)).toEqual({ x: 9 * px, width: 5 * px });
      expect(barGeometry({ start: "2026-11-10", end: "2026-11-10" }, range, zoom).width).toBe(px);
    });
  }
});

describe("AC5.3: visible range", () => {
  it("covers all dates plus padding and always includes today", () => {
    const sections = buildTimeline({
      ...base,
      boards: [board("b1")],
      tasks: [task("t", { startDate: "2027-03-01", endDate: "2027-03-05", deadline: "2027-03-10" })],
      milestones: [ms("m", "2027-04-01")],
    });
    const r = visibleRange(sections, "2026-11-10", "day");
    expect(r.start <= "2026-11-10").toBe(true);
    expect(r.end >= "2027-04-01").toBe(true);
    expect(r).toEqual({ start: "2026-11-03", end: "2027-04-08" });
  });

  it("snaps the start to a Monday (week) or the 1st (month)", () => {
    const empty = buildTimeline({ ...base, boards: [], tasks: [], milestones: [] });
    expect(visibleRange(empty, "2026-11-12", "week").start).toBe("2026-10-26");
    expect(visibleRange(empty, "2026-11-12", "month").start).toBe("2026-09-01");
  });

  it("ticks: Mondays at week zoom, 1sts at month zoom", () => {
    const range = { start: "2026-11-01", end: "2026-12-31" };
    expect(ticks(range, "week").map((t) => t.date).slice(0, 3)).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(ticks(range, "month").map((t) => t.date)).toEqual(["2026-11-01", "2026-12-01"]);
    expect(ticks(range, "day")).toHaveLength(61);
  });
});

describe("AC8.1: drag to planned dates", () => {
  const both = { startDate: "2026-11-10", endDate: "2026-11-14" };
  it("move shifts start and end by the delta", () => {
    expect(dragPlannedDates(both, "move", 2)).toEqual({ startDate: "2026-11-12", endDate: "2026-11-16" });
    expect(dragPlannedDates(both, "move", -10)).toEqual({ startDate: "2026-10-31", endDate: "2026-11-04" });
  });
  it("move shifts only the date that is set", () => {
    expect(dragPlannedDates({ startDate: "2026-11-10", endDate: null }, "move", 3)).toEqual({ startDate: "2026-11-13", endDate: null });
    expect(dragPlannedDates({ startDate: null, endDate: "2026-11-10" }, "move", -1)).toEqual({ startDate: null, endDate: "2026-11-09" });
  });
  it("resizing changes one end only", () => {
    expect(dragPlannedDates(both, "start", -2)).toEqual({ startDate: "2026-11-08", endDate: "2026-11-14" });
    expect(dragPlannedDates(both, "end", 3)).toEqual({ startDate: "2026-11-10", endDate: "2026-11-17" });
  });
  it("resizing clamps so start <= end (a bar is at least one day)", () => {
    expect(dragPlannedDates(both, "start", 9)).toEqual({ startDate: "2026-11-14", endDate: "2026-11-14" });
    expect(dragPlannedDates(both, "end", -9)).toEqual({ startDate: "2026-11-10", endDate: "2026-11-10" });
  });
  it("resizing a one-date bar sets both dates", () => {
    expect(dragPlannedDates({ startDate: "2026-11-10", endDate: null }, "end", 4)).toEqual({ startDate: "2026-11-10", endDate: "2026-11-14" });
    expect(dragPlannedDates({ startDate: null, endDate: "2026-11-10" }, "start", -2)).toEqual({ startDate: "2026-11-08", endDate: "2026-11-10" });
  });
  it("a zero delta returns the dates unchanged", () => {
    const one = { startDate: "2026-11-10", endDate: null };
    expect(dragPlannedDates(one, "end", 0)).toEqual(one);
    expect(dragPlannedDates(both, "move", 0)).toEqual(both);
  });
});

describe("AC8.2: pixels to days", () => {
  it.each(["day", "week", "month"] as Zoom[])("rounds to the nearest whole day (%s)", (zoom) => {
    const px = PX_PER_DAY[zoom];
    expect(dayDelta(0, zoom)).toBe(0);
    expect(dayDelta(px * 0.4, zoom)).toBe(0);
    expect(dayDelta(px * 0.6, zoom)).toBe(1);
    expect(dayDelta(px * 3, zoom)).toBe(3);
    expect(dayDelta(-px * 2.6, zoom)).toBe(-3);
  });
});
