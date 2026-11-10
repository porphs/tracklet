import { daysBetween } from "./dates";
import type { DateStr, Milestone, Task } from "./types";

export const DEFAULT_NEAR_WINDOW = 3;
export const MIN_NEAR_WINDOW = 1;
export const MAX_NEAR_WINDOW = 30;

export type DeadlineStatus = "overdue" | "near" | "none";

export interface StatusInfo {
  status: DeadlineStatus;
  /** Days from today to the date (negative when overdue). Null when there is no date. */
  days: number | null;
}

/**
 * Deadline status (docs/mvp-spec.md §2). `closed` means a done task or a reached milestone;
 * those never warn.
 */
export function deadlineStatus(date: DateStr | null, today: DateStr, nearWindow: number, closed: boolean): StatusInfo {
  if (!date) return { status: "none", days: null };
  const days = daysBetween(today, date);
  if (closed) return { status: "none", days };
  if (days < 0) return { status: "overdue", days };
  if (days <= nearWindow) return { status: "near", days };
  return { status: "none", days };
}

/** The text badge that always goes with the status colour. */
export function statusBadge(info: StatusInfo): string | null {
  if (info.days === null) return null;
  if (info.status === "overdue") return `Overdue ${-info.days}d`;
  if (info.status === "near") return info.days === 0 ? "Due today" : `Due in ${info.days}d`;
  return null;
}

export type TaskWarning = "end-after-deadline" | "after-milestone";

export const WARNING_TEXT: Record<TaskWarning, string> = {
  "end-after-deadline": "Planned end is after the deadline",
  "after-milestone": "Deadline is after its milestone",
};

export function taskWarnings(task: Task, milestone: Milestone | undefined, done: boolean): TaskWarning[] {
  if (done) return [];
  const w: TaskWarning[] = [];
  if (task.endDate && task.deadline && task.endDate > task.deadline) w.push("end-after-deadline");
  if (task.deadline && milestone && task.deadline > milestone.date) w.push("after-milestone");
  return w;
}

export interface Counts {
  overdue: number;
  near: number;
}

/** Overdue/near counts over a board's open tasks and open milestones. */
export function countStatuses(
  tasks: { task: Task; done: boolean }[],
  milestones: Milestone[],
  today: DateStr,
  nearWindow: number,
): Counts {
  const counts: Counts = { overdue: 0, near: 0 };
  const add = (s: DeadlineStatus) => {
    if (s === "overdue") counts.overdue++;
    if (s === "near") counts.near++;
  };
  for (const { task, done } of tasks) add(deadlineStatus(task.deadline, today, nearWindow, done).status);
  for (const m of milestones) add(deadlineStatus(m.date, today, nearWindow, m.isReached).status);
  return counts;
}

export function clampNearWindow(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_NEAR_WINDOW;
  return Math.max(MIN_NEAR_WINDOW, Math.min(MAX_NEAR_WINDOW, Math.round(n)));
}
