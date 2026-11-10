import { addDays } from "./dates";
import { matchesLabelFilter } from "./filter";
import type { DateStr, Label, Milestone, Task } from "./types";

/** Monday = 0 … Sunday = 6 for a date string. */
function weekdayMondayFirst(date: DateStr): number {
  const [y, m, d] = date.split("-").map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function monthStart(date: DateStr): DateStr {
  return `${date.slice(0, 7)}-01`;
}

/** Moves a month start by n months (n may be negative). */
export function addMonths(monthStartDate: DateStr, n: number): DateStr {
  const [y, m] = monthStartDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + n, 1));
  return dt.toISOString().slice(0, 10);
}

/**
 * Whole weeks, Monday → Sunday, covering the month of `anyDayInMonth`,
 * including leading/trailing days from neighbouring months.
 */
export function monthGrid(anyDayInMonth: DateStr): DateStr[][] {
  const first = monthStart(anyDayInMonth);
  const month = first.slice(0, 7);
  let day = addDays(first, -weekdayMondayFirst(first));
  const weeks: DateStr[][] = [];
  do {
    const week: DateStr[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(day);
      day = addDays(day, 1);
    }
    weeks.push(week);
  } while (day.slice(0, 7) === month);
  return weeks;
}

export type CalendarItem =
  | { kind: "milestone"; milestone: Milestone; boardId: string }
  | { kind: "task"; task: Task; done: boolean; boardId: string };

export interface CalendarInput {
  tasks: Task[];
  milestones: Milestone[];
  doneColumnIds: Set<string>;
  labelsByTask: Map<string, Label[]>;
  labelFilter: string | null;
  /** Optional range to keep the result small (inclusive). */
  from?: DateStr;
  to?: DateStr;
}

/**
 * Calendar entries keyed by date: task deadlines and milestone dates only (never start/end).
 * The label filter applies to tasks; milestones always show. Milestones come first each day.
 */
export function calendarItems(input: CalendarInput): Map<DateStr, CalendarItem[]> {
  const inRange = (d: DateStr) => (!input.from || d >= input.from) && (!input.to || d <= input.to);
  const map = new Map<DateStr, CalendarItem[]>();
  const push = (d: DateStr, item: CalendarItem) => {
    const list = map.get(d) ?? [];
    list.push(item);
    map.set(d, list);
  };
  for (const m of input.milestones) {
    if (inRange(m.date)) push(m.date, { kind: "milestone", milestone: m, boardId: m.boardId });
  }
  for (const t of input.tasks) {
    if (!t.deadline || !inRange(t.deadline)) continue;
    if (!matchesLabelFilter(input.labelsByTask.get(t.id), input.labelFilter)) continue;
    push(t.deadline, { kind: "task", task: t, done: input.doneColumnIds.has(t.columnId), boardId: t.boardId });
  }
  return map;
}
