import { addDays, daysBetween } from "./dates";
import { matchesLabelFilter } from "./filter";
import type { Board, DateStr, Label, Milestone, Task } from "./types";

export type Zoom = "day" | "week" | "month";

export const PX_PER_DAY: Record<Zoom, number> = { day: 36, week: 14, month: 4 };
const PADDING_DAYS: Record<Zoom, number> = { day: 7, week: 14, month: 45 };

export interface TimelineTask {
  task: Task;
  done: boolean;
  /** Planned bar, inclusive. A single planned date gives a one-day bar. Null for deadline-only tasks. */
  bar: { start: DateStr; end: DateStr } | null;
}

export interface TimelineGroup {
  key: string;
  boardId: string;
  /** Null for the "No milestone" group. */
  milestone: Milestone | null;
  tasks: TimelineTask[];
}

export interface TimelineSection {
  board: Board;
  groups: TimelineGroup[];
}

export interface RowInput {
  boards: Board[];
  tasks: Task[];
  milestones: Milestone[];
  doneColumnIds: Set<string>;
  labelsByTask: Map<string, Label[]>;
  labelFilter: string | null;
}

/** The date a task sorts by: start, else deadline, else end. */
function sortKey(t: Task): DateStr {
  return t.startDate ?? t.deadline ?? t.endDate ?? "9999-12-31";
}

/**
 * Rows for the timeline, per board (in board order): one group per milestone (by date),
 * then "No milestone". Tasks without any date are left out. The label filter applies to
 * tasks; milestone groups always show (spec §2).
 */
export function buildTimeline(input: RowInput): TimelineSection[] {
  return input.boards.map((board) => {
    const tasks = input.tasks
      .filter((t) => t.boardId === board.id)
      .filter((t) => t.startDate || t.endDate || t.deadline)
      .filter((t) => matchesLabelFilter(input.labelsByTask.get(t.id), input.labelFilter))
      .sort((a, b) => sortKey(a).localeCompare(sortKey(b)) || a.title.localeCompare(b.title));
    const toRow = (task: Task): TimelineTask => {
      const s = task.startDate ?? task.endDate;
      const e = task.endDate ?? task.startDate;
      return { task, done: input.doneColumnIds.has(task.columnId), bar: s && e ? { start: s, end: e } : null };
    };
    const milestones = input.milestones
      .filter((m) => m.boardId === board.id)
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
    const ids = new Set(milestones.map((m) => m.id));
    const groups: TimelineGroup[] = milestones.map((m) => ({
      key: m.id,
      boardId: board.id,
      milestone: m,
      tasks: tasks.filter((t) => t.milestoneId === m.id).map(toRow),
    }));
    const loose = tasks.filter((t) => !t.milestoneId || !ids.has(t.milestoneId)).map(toRow);
    if (loose.length) groups.push({ key: `none:${board.id}`, boardId: board.id, milestone: null, tasks: loose });
    return { board, groups };
  });
}

export interface Range {
  start: DateStr;
  end: DateStr;
}

/** Start of the week (Monday) or month containing `d`, so the header lines up. */
function snapStart(d: DateStr, zoom: Zoom): DateStr {
  if (zoom === "month") return `${d.slice(0, 7)}-01`;
  if (zoom === "week") {
    const [y, m, dd] = d.split("-").map(Number);
    const wd = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7;
    return addDays(d, -wd);
  }
  return d;
}

/** The range to draw: every shown date plus padding, always including today. */
export function visibleRange(sections: TimelineSection[], today: DateStr, zoom: Zoom): Range {
  const dates: DateStr[] = [today];
  for (const s of sections)
    for (const g of s.groups) {
      if (g.milestone) dates.push(g.milestone.date);
      for (const t of g.tasks) {
        if (t.bar) dates.push(t.bar.start, t.bar.end);
        if (t.task.deadline) dates.push(t.task.deadline);
      }
    }
  dates.sort();
  const pad = PADDING_DAYS[zoom];
  return { start: snapStart(addDays(dates[0], -pad), zoom), end: addDays(dates[dates.length - 1], pad) };
}

export function totalDays(range: Range): number {
  return daysBetween(range.start, range.end) + 1;
}

/** Left edge (px) of a date's day cell. */
export function dateToX(date: DateStr, range: Range, zoom: Zoom): number {
  return daysBetween(range.start, date) * PX_PER_DAY[zoom];
}

/** The date whose day cell contains x (inverse of dateToX). */
export function xToDate(x: number, range: Range, zoom: Zoom): DateStr {
  return addDays(range.start, Math.floor(x / PX_PER_DAY[zoom]));
}

/** Bar geometry: covers start..end inclusive of the end day. */
export function barGeometry(bar: { start: DateStr; end: DateStr }, range: Range, zoom: Zoom): { x: number; width: number } {
  return {
    x: dateToX(bar.start, range, zoom),
    width: (daysBetween(bar.start, bar.end) + 1) * PX_PER_DAY[zoom],
  };
}

export interface Tick {
  date: DateStr;
  x: number;
  label: string;
}

/** Header ticks: every day (day zoom), every Monday (week zoom), every 1st (month zoom). */
export function ticks(range: Range, zoom: Zoom): Tick[] {
  const out: Tick[] = [];
  for (let d = range.start; d <= range.end; d = addDays(d, 1)) {
    const [y, m, dd] = d.split("-").map(Number);
    const local = new Date(y, m - 1, dd);
    const isMonday = local.getDay() === 1;
    let label: string | null = null;
    if (zoom === "day") label = String(dd) + (dd === 1 || d === range.start ? ` ${local.toLocaleDateString(undefined, { month: "short" })}` : "");
    else if (zoom === "week" && isMonday) label = local.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    else if (zoom === "month" && dd === 1) label = local.toLocaleDateString(undefined, { month: "short", year: "numeric" });
    if (label) out.push({ date: d, x: dateToX(d, range, zoom), label });
  }
  return out;
}

/** What a drag on a task bar changes: the whole bar, or one of its ends. */
export type BarDrag = "move" | "start" | "end";

export interface PlannedDates {
  startDate: DateStr | null;
  endDate: DateStr | null;
}

/** Whole days for a horizontal drag of `dx` pixels, rounded to the nearest day (spec slice 8). */
export function dayDelta(dx: number, zoom: Zoom): number {
  return Math.round(dx / PX_PER_DAY[zoom]) || 0; // `|| 0` turns -0 into 0
}

/**
 * The planned dates after dragging a bar by `delta` days (spec slice 8). Moving shifts
 * whichever dates are set. Resizing changes one end, clamped so start <= end, and writes both
 * dates so a one-date bar keeps the shape you see. The deadline is never touched here.
 */
export function dragPlannedDates(dates: PlannedDates, kind: BarDrag, delta: number): PlannedDates {
  if (delta === 0) return dates;
  if (kind === "move") {
    return {
      startDate: dates.startDate && addDays(dates.startDate, delta),
      endDate: dates.endDate && addDays(dates.endDate, delta),
    };
  }
  const start = dates.startDate ?? dates.endDate;
  const end = dates.endDate ?? dates.startDate;
  if (!start || !end) return dates;
  if (kind === "start") {
    const s = addDays(start, delta);
    return { startDate: s > end ? end : s, endDate: end };
  }
  const e = addDays(end, delta);
  return { startDate: start, endDate: e < start ? start : e };
}
