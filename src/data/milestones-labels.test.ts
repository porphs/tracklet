import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../storage/open";
import { migrate } from "../storage/migrations";
import { Repository } from "./repository";
import { ValidationError } from "../domain/types";
import { labelNames, matchesLabelFilter } from "../domain/filter";

let repo: Repository;

beforeEach(async () => {
  const sql = await openDatabase(null);
  migrate(sql);
  repo = new Repository(sql, { now: () => new Date("2026-11-10T09:00:00Z") });
});

function board(name = "B") {
  const b = repo.createBoard(name);
  return { b, col: repo.listColumns(b.id)[0] };
}

describe("milestones", () => {
  it("requires a title and a valid date", () => {
    const { b } = board();
    expect(() => repo.createMilestone(b.id, "", "2026-12-01")).toThrow(ValidationError);
    expect(() => repo.createMilestone(b.id, "v1", "")).toThrow(/needs a date/);
    expect(() => repo.createMilestone(b.id, "v1", "2026-13-01")).toThrow(ValidationError);
    const m = repo.createMilestone(b.id, "v1", "2026-12-01");
    expect(() => repo.updateMilestone(m.id, { date: "" })).toThrow(/needs a date/);
    expect(repo.updateMilestone(m.id, { isReached: true }).isReached).toBe(true);
  });

  it("lists by date", () => {
    const { b } = board();
    repo.createMilestone(b.id, "later", "2026-12-20");
    repo.createMilestone(b.id, "sooner", "2026-12-01");
    expect(repo.listMilestones(b.id).map((m) => m.title)).toEqual(["sooner", "later"]);
  });

  it("AC3.4: deleting unlinks its tasks without deleting them; undo re-links", () => {
    const { b, col } = board();
    const m = repo.createMilestone(b.id, "v1", "2026-12-01");
    const t1 = repo.createTask({ boardId: b.id, columnId: col.id, title: "a", milestoneId: m.id });
    const t2 = repo.createTask({ boardId: b.id, columnId: col.id, title: "b", milestoneId: m.id });
    const t3 = repo.createTask({ boardId: b.id, columnId: col.id, title: "c" });
    const deleted = repo.deleteMilestone(m.id);
    expect(repo.getMilestone(m.id)).toBeUndefined();
    expect(repo.listTasks(b.id).map((t) => [t.title, t.milestoneId])).toEqual([
      ["a", null],
      ["b", null],
      ["c", null],
    ]);
    repo.restore(deleted);
    expect(repo.getMilestone(m.id)).toEqual(m);
    expect([t1, t2, t3].map((t) => repo.getTask(t.id)!.milestoneId)).toEqual([m.id, m.id, null]);
  });

  it("AC3.6: a milestone from another board is rejected", () => {
    const { b, col } = board("One");
    const other = board("Two");
    const m = repo.createMilestone(other.b.id, "x", "2026-12-01");
    expect(() => repo.createTask({ boardId: b.id, columnId: col.id, title: "t", milestoneId: m.id })).toThrow(
      ValidationError,
    );
  });
});

describe("labels", () => {
  it("validates name and colour; R7 names unique per board ignoring case", () => {
    const { b } = board();
    expect(() => repo.createLabel(b.id, " ", "red")).toThrow(ValidationError);
    expect(() => repo.createLabel(b.id, "bug", "pink")).toThrow(/colour/);
    const bug = repo.createLabel(b.id, "bug", "red");
    expect(() => repo.createLabel(b.id, " BUG ", "blue")).toThrow(/already a label/);
    const ui = repo.createLabel(b.id, "ui", "blue");
    expect(() => repo.updateLabel(ui.id, { name: "Bug" })).toThrow(/already a label/);
    expect(repo.updateLabel(bug.id, { name: "Bug", color: "green" })).toMatchObject({ name: "Bug", color: "green" });
    // the same name on another board is fine
    expect(() => repo.createLabel(board("Other").b.id, "bug", "red")).not.toThrow();
  });

  it("assigns and removes labels on tasks", () => {
    const { b, col } = board();
    const t = repo.createTask({ boardId: b.id, columnId: col.id, title: "t" });
    const l = repo.createLabel(b.id, "bug", "red");
    repo.setTaskLabel(t.id, l.id, true);
    repo.setTaskLabel(t.id, l.id, true); // idempotent
    expect(repo.taskLabelIds(t.id)).toEqual([l.id]);
    repo.setTaskLabel(t.id, l.id, false);
    expect(repo.taskLabelIds(t.id)).toEqual([]);
  });

  it("AC3.6: a label from another board is rejected", () => {
    const { b, col } = board("One");
    const t = repo.createTask({ boardId: b.id, columnId: col.id, title: "t" });
    const foreign = repo.createLabel(board("Two").b.id, "bug", "red");
    expect(() => repo.setTaskLabel(t.id, foreign.id, true)).toThrow(ValidationError);
  });

  it("AC3.5: deleting removes it from its tasks; undo restores the links", () => {
    const { b, col } = board();
    const t1 = repo.createTask({ boardId: b.id, columnId: col.id, title: "a" });
    const t2 = repo.createTask({ boardId: b.id, columnId: col.id, title: "b" });
    const l = repo.createLabel(b.id, "bug", "red");
    repo.setTaskLabel(t1.id, l.id, true);
    repo.setTaskLabel(t2.id, l.id, true);
    const deleted = repo.deleteLabel(l.id);
    expect(repo.getLabel(l.id)).toBeUndefined();
    expect(repo.taskLabelIds(t1.id)).toEqual([]);
    expect(repo.listTasks(b.id)).toHaveLength(2);
    repo.restore(deleted);
    expect(repo.getLabel(l.id)).toEqual(l);
    expect([repo.taskLabelIds(t1.id), repo.taskLabelIds(t2.id)]).toEqual([[l.id], [l.id]]);
  });

  it("AC3.7: filtering by label, per board and across boards by name", () => {
    const one = board("One");
    const two = board("Two");
    const a = repo.createTask({ boardId: one.b.id, columnId: one.col.id, title: "a" });
    repo.createTask({ boardId: one.b.id, columnId: one.col.id, title: "b" });
    const c = repo.createTask({ boardId: two.b.id, columnId: two.col.id, title: "c" });
    repo.setTaskLabel(a.id, repo.createLabel(one.b.id, "Urgent", "red").id, true);
    repo.setTaskLabel(c.id, repo.createLabel(two.b.id, "urgent", "orange").id, true);

    const perBoard = repo.labelsByTask(one.b.id);
    expect(repo.listTasks(one.b.id).filter((t) => matchesLabelFilter(perBoard.get(t.id), "Urgent")).map((t) => t.title))
      .toEqual(["a"]);

    const all = repo.labelsByTask(null);
    expect(repo.listAllTasks().filter((t) => matchesLabelFilter(all.get(t.id), "URGENT")).map((t) => t.title)).toEqual([
      "a",
      "c",
    ]);
    expect(repo.listAllTasks().filter((t) => matchesLabelFilter(all.get(t.id), null))).toHaveLength(3);
    expect(labelNames(repo.listAllLabels())).toEqual(["Urgent"]);
  });
});

describe("near window setting", () => {
  it("defaults to 3, persists and clamps", () => {
    expect(repo.nearWindow()).toBe(3);
    expect(repo.setNearWindow(7)).toBe(7);
    expect(repo.nearWindow()).toBe(7);
    expect(repo.setNearWindow(100)).toBe(30);
  });
});
