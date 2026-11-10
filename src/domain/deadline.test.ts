import { describe, expect, it } from "vitest";
import { clampNearWindow, countStatuses, deadlineStatus, statusBadge, taskWarnings } from "./deadline";
import type { Milestone, Task } from "./types";

const today = "2026-11-10";

const task = (over: Partial<Task> = {}): Task => ({
  id: "t",
  boardId: "b",
  columnId: "c",
  title: "T",
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

const milestone = (over: Partial<Milestone> = {}): Milestone => ({
  id: "m",
  boardId: "b",
  title: "M",
  description: "",
  date: "2026-11-15",
  isReached: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("AC3.1: deadline status", () => {
  for (const N of [3, 7]) {
    it(`with near window ${N}`, () => {
      expect(deadlineStatus(null, today, N, false)).toEqual({ status: "none", days: null });
      expect(deadlineStatus("2026-11-09", today, N, false)).toEqual({ status: "overdue", days: -1 });
      expect(deadlineStatus(today, today, N, false)).toEqual({ status: "near", days: 0 });
      const edge = `2026-11-${String(10 + N).padStart(2, "0")}`;
      const beyond = `2026-11-${String(11 + N).padStart(2, "0")}`;
      expect(deadlineStatus(edge, today, N, false)).toEqual({ status: "near", days: N });
      expect(deadlineStatus(beyond, today, N, false)).toEqual({ status: "none", days: N + 1 });
      // done task / reached milestone with a past date
      expect(deadlineStatus("2026-11-01", today, N, true).status).toBe("none");
    });
  }

  it("crosses month and year boundaries", () => {
    expect(deadlineStatus("2027-01-01", "2026-12-30", 3, false)).toEqual({ status: "near", days: 2 });
    expect(deadlineStatus("2026-02-28", "2026-03-01", 3, false)).toEqual({ status: "overdue", days: -1 });
  });

  it("badge text", () => {
    expect(statusBadge({ status: "overdue", days: -2 })).toBe("Overdue 2d");
    expect(statusBadge({ status: "near", days: 0 })).toBe("Due today");
    expect(statusBadge({ status: "near", days: 1 })).toBe("Due in 1d");
    expect(statusBadge({ status: "none", days: 10 })).toBeNull();
    expect(statusBadge({ status: "none", days: null })).toBeNull();
  });
});

describe("AC3.2: task warnings", () => {
  it("end-after-deadline", () => {
    expect(taskWarnings(task({ endDate: "2026-11-20", deadline: "2026-11-18" }), undefined, false)).toEqual([
      "end-after-deadline",
    ]);
    expect(taskWarnings(task({ endDate: "2026-11-18", deadline: "2026-11-18" }), undefined, false)).toEqual([]);
    expect(taskWarnings(task({ endDate: "2026-11-20" }), undefined, false)).toEqual([]);
  });

  it("after-milestone", () => {
    const m = milestone({ date: "2026-11-15" });
    expect(taskWarnings(task({ deadline: "2026-11-16" }), m, false)).toEqual(["after-milestone"]);
    expect(taskWarnings(task({ deadline: "2026-11-15" }), m, false)).toEqual([]);
    expect(taskWarnings(task({ deadline: null }), m, false)).toEqual([]);
  });

  it("never for done tasks", () => {
    const t = task({ endDate: "2026-11-20", deadline: "2026-11-18" });
    expect(taskWarnings(t, milestone({ date: "2026-11-01" }), true)).toEqual([]);
  });
});

describe("AC3.3: board counts", () => {
  it("counts open overdue/near tasks and milestones only", () => {
    const tasks = [
      { task: task({ deadline: "2026-11-01" }), done: false }, // overdue
      { task: task({ deadline: "2026-11-02" }), done: false }, // overdue
      { task: task({ deadline: "2026-11-01" }), done: true }, // done: ignored
      { task: task({ deadline: today }), done: false }, // near
      { task: task({ deadline: "2026-11-13" }), done: false }, // near (N=3)
      { task: task({ deadline: "2026-11-14" }), done: false }, // none
      { task: task(), done: false }, // no deadline
    ];
    const ms = [
      milestone({ date: "2026-11-05" }), // overdue
      milestone({ date: "2026-11-05", isReached: true }), // reached: ignored
      milestone({ date: "2026-11-11" }), // near
    ];
    expect(countStatuses(tasks, ms, today, 3)).toEqual({ overdue: 3, near: 3 });
  });
});

describe("near window bounds", () => {
  it("clamps to 1..30", () => {
    expect(clampNearWindow(0)).toBe(1);
    expect(clampNearWindow(99)).toBe(30);
    expect(clampNearWindow(4.6)).toBe(5);
    expect(clampNearWindow(NaN)).toBe(3);
  });
});
