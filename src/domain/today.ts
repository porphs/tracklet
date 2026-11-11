import type { Board, Column, DateStr, Task } from "./types";

export interface TodayTask {
  task: Task;
  column: Column | undefined;
  /** Planned span, inclusive. A single planned date counts as a one-day span. */
  start: DateStr;
  end: DateStr;
}

export interface TodaySection {
  board: Board;
  tasks: TodayTask[];
}

/** The planned span of a task, as the timeline draws it; null when it has no planned dates. */
export function plannedSpan(task: Task): { start: DateStr; end: DateStr } | null {
  const start = task.startDate ?? task.endDate;
  const end = task.endDate ?? task.startDate;
  return start && end ? { start, end } : null;
}

/**
 * Open tasks whose planned dates overlap `today` (start ≤ today ≤ end), grouped by board in
 * board order. Done tasks and tasks without planned dates are left out. Within a board, tasks
 * that end soonest come first.
 */
export function tasksForToday(input: {
  boards: Board[];
  tasks: Task[];
  columns: Column[];
  today: DateStr;
}): TodaySection[] {
  const columns = new Map(input.columns.map((c) => [c.id, c]));
  return input.boards
    .map((board) => ({
      board,
      tasks: input.tasks
        .filter((t) => t.boardId === board.id && !columns.get(t.columnId)?.isDoneColumn)
        .flatMap((task): TodayTask[] => {
          const span = plannedSpan(task);
          if (!span || span.start > input.today || span.end < input.today) return [];
          return [{ task, column: columns.get(task.columnId), ...span }];
        })
        .sort((a, b) => a.end.localeCompare(b.end) || a.task.title.localeCompare(b.task.title)),
    }))
    .filter((s) => s.tasks.length > 0);
}
