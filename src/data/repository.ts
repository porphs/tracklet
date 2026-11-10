import type { Sql } from "../storage/sql";
import { isValidDate } from "../domain/dates";
import {
  ValidationError,
  type Board,
  type Column,
  type DateStr,
  type Task,
} from "../domain/types";

/**
 * All reads and writes of Tracklet data, with the spec's rules enforced (docs/mvp-spec.md §1).
 * Every public mutation is one transaction.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export type TaskPatch = Partial<
  Pick<Task, "title" | "description" | "startDate" | "endDate" | "deadline" | "milestoneId">
>;

export interface NewTask {
  boardId: string;
  columnId: string;
  title: string;
  description?: string;
  startDate?: DateStr | null;
  endDate?: DateStr | null;
  deadline?: DateStr | null;
  milestoneId?: string | null;
}

/** What is needed to undo a deletion. */
export type Deleted = { kind: "task"; task: Task; labelIds: string[] };

export const DEFAULT_COLUMNS: { name: string; done: boolean }[] = [
  { name: "To do", done: false },
  { name: "Doing", done: false },
  { name: "Done", done: true },
];

// ---------- row mapping ----------

type Row = Record<string, any>;

const toBoard = (r: Row): Board => ({
  id: r.id,
  name: r.name,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toColumn = (r: Row): Column => ({
  id: r.id,
  boardId: r.board_id,
  name: r.name,
  position: r.position,
  isDoneColumn: r.is_done_column === 1,
});

const toTask = (r: Row): Task => ({
  id: r.id,
  boardId: r.board_id,
  columnId: r.column_id,
  title: r.title,
  description: r.description,
  startDate: r.start_date,
  endDate: r.end_date,
  deadline: r.deadline,
  milestoneId: r.milestone_id,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---------- helpers ----------

function requireName(value: string, what: string): string {
  const v = value.trim();
  if (!v) throw new ValidationError(`${what} cannot be empty.`);
  return v;
}

function checkDate(value: DateStr | null | undefined, what: string): DateStr | null {
  if (value === null || value === undefined || value === "") return null;
  if (!isValidDate(value)) throw new ValidationError(`${what} must be a valid date (YYYY-MM-DD).`);
  return value;
}

export class Repository {
  constructor(
    private sql: Sql,
    private clock: Clock = systemClock,
    private newId: () => string = () => crypto.randomUUID(),
  ) {}

  private stamp(): string {
    return this.clock.now().toISOString();
  }

  // ---------- settings ----------

  getSetting(key: string): string | undefined {
    return this.sql.get<{ value: string }>("SELECT value FROM setting WHERE key = ?", [key])?.value;
  }

  setSetting(key: string, value: string): void {
    this.sql.run(
      "INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    );
  }

  // ---------- boards ----------

  listBoards(): Board[] {
    return this.sql.all<Row>("SELECT * FROM board ORDER BY position").map(toBoard);
  }

  getBoard(id: string): Board | undefined {
    const r = this.sql.get<Row>("SELECT * FROM board WHERE id = ?", [id]);
    return r && toBoard(r);
  }

  /** Creates a board with the default columns (To do / Doing / Done). */
  createBoard(name: string): Board {
    const clean = requireName(name, "Board name");
    return this.sql.tx(() => {
      const id = this.newId();
      const now = this.stamp();
      const position = this.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM board")!.n;
      this.sql.run(
        "INSERT INTO board (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        [id, clean, position, now, now],
      );
      DEFAULT_COLUMNS.forEach((c, i) => {
        this.sql.run(
          "INSERT INTO board_column (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)",
          [this.newId(), id, c.name, i, c.done ? 1 : 0],
        );
      });
      return this.getBoard(id)!;
    });
  }

  /** First-launch seeding: only when there are no boards at all. Returns true if it seeded. */
  seedIfEmpty(): boolean {
    if (this.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM board")!.n > 0) return false;
    this.createBoard("My board");
    return true;
  }

  // ---------- columns ----------

  listColumns(boardId: string): Column[] {
    return this.sql
      .all<Row>("SELECT * FROM board_column WHERE board_id = ? ORDER BY position", [boardId])
      .map(toColumn);
  }

  getColumn(id: string): Column | undefined {
    const r = this.sql.get<Row>("SELECT * FROM board_column WHERE id = ?", [id]);
    return r && toColumn(r);
  }

  // ---------- tasks ----------

  listTasks(boardId: string): Task[] {
    return this.sql
      .all<Row>(
        `SELECT t.* FROM task t JOIN board_column c ON c.id = t.column_id
         WHERE t.board_id = ? ORDER BY c.position, t.position`,
        [boardId],
      )
      .map(toTask);
  }

  listTasksInColumn(columnId: string): Task[] {
    return this.sql
      .all<Row>("SELECT * FROM task WHERE column_id = ? ORDER BY position", [columnId])
      .map(toTask);
  }

  getTask(id: string): Task | undefined {
    const r = this.sql.get<Row>("SELECT * FROM task WHERE id = ?", [id]);
    return r && toTask(r);
  }

  taskLabelIds(taskId: string): string[] {
    return this.sql
      .all<{ label_id: string }>("SELECT label_id FROM task_label WHERE task_id = ? ORDER BY label_id", [taskId])
      .map((r) => r.label_id);
  }

  private requireColumnOnBoard(columnId: string, boardId: string): Column {
    const col = this.getColumn(columnId);
    if (!col || col.boardId !== boardId) throw new ValidationError("That column is not on this board.");
    return col;
  }

  private requireMilestoneOnBoard(milestoneId: string | null | undefined, boardId: string): string | null {
    if (!milestoneId) return null;
    const m = this.sql.get<{ board_id: string }>("SELECT board_id FROM milestone WHERE id = ?", [milestoneId]);
    if (!m || m.board_id !== boardId) throw new ValidationError("That milestone is not on this board.");
    return milestoneId;
  }

  private checkPlannedDates(start: DateStr | null, end: DateStr | null): void {
    if (start && end && end < start) throw new ValidationError("End date cannot be before start date.");
  }

  createTask(input: NewTask): Task {
    const title = requireName(input.title, "Title");
    return this.sql.tx(() => {
      this.requireColumnOnBoard(input.columnId, input.boardId);
      const startDate = checkDate(input.startDate, "Start date");
      const endDate = checkDate(input.endDate, "End date");
      const deadline = checkDate(input.deadline, "Deadline");
      this.checkPlannedDates(startDate, endDate);
      const milestoneId = this.requireMilestoneOnBoard(input.milestoneId, input.boardId);
      const id = this.newId();
      const now = this.stamp();
      const position = this.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM task WHERE column_id = ?", [
        input.columnId,
      ])!.n;
      this.sql.run(
        `INSERT INTO task (id, board_id, column_id, title, description, start_date, end_date, deadline,
                           milestone_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, input.boardId, input.columnId, title, input.description ?? "", startDate, endDate, deadline,
          milestoneId, position, now, now],
      );
      return this.getTask(id)!;
    });
  }

  updateTask(id: string, patch: TaskPatch): Task {
    return this.sql.tx(() => {
      const t = this.getTask(id);
      if (!t) throw new ValidationError("Task not found.");
      const next = {
        title: patch.title !== undefined ? requireName(patch.title, "Title") : t.title,
        description: patch.description ?? t.description,
        startDate: patch.startDate !== undefined ? checkDate(patch.startDate, "Start date") : t.startDate,
        endDate: patch.endDate !== undefined ? checkDate(patch.endDate, "End date") : t.endDate,
        deadline: patch.deadline !== undefined ? checkDate(patch.deadline, "Deadline") : t.deadline,
        milestoneId:
          patch.milestoneId !== undefined ? this.requireMilestoneOnBoard(patch.milestoneId, t.boardId) : t.milestoneId,
      };
      this.checkPlannedDates(next.startDate, next.endDate);
      this.sql.run(
        `UPDATE task SET title = ?, description = ?, start_date = ?, end_date = ?, deadline = ?,
                         milestone_id = ?, updated_at = ? WHERE id = ?`,
        [next.title, next.description, next.startDate, next.endDate, next.deadline, next.milestoneId,
          this.stamp(), id],
      );
      return this.getTask(id)!;
    });
  }

  /**
   * Moves a task to `toIndex` in `toColumnId` (same board). Indexes are clamped.
   * Positions in both columns stay 0..n-1 (R6).
   */
  moveTask(id: string, toColumnId: string, toIndex: number): Task {
    return this.sql.tx(() => {
      const t = this.getTask(id);
      if (!t) throw new ValidationError("Task not found.");
      this.requireColumnOnBoard(toColumnId, t.boardId);
      // Take it out of its current column and close the gap.
      this.sql.run("UPDATE task SET position = position - 1 WHERE column_id = ? AND position > ?", [
        t.columnId,
        t.position,
      ]);
      const count = this.sql.get<{ n: number }>(
        "SELECT COUNT(*) AS n FROM task WHERE column_id = ? AND id != ?",
        [toColumnId, id],
      )!.n;
      const index = Math.max(0, Math.min(Math.trunc(toIndex), count));
      this.sql.run("UPDATE task SET position = position + 1 WHERE column_id = ? AND id != ? AND position >= ?", [
        toColumnId,
        id,
        index,
      ]);
      const touched = t.columnId !== toColumnId || t.position !== index;
      this.sql.run(
        `UPDATE task SET column_id = ?, position = ?${touched ? ", updated_at = ?" : ""} WHERE id = ?`,
        touched ? [toColumnId, index, this.stamp(), id] : [toColumnId, index, id],
      );
      return this.getTask(id)!;
    });
  }

  deleteTask(id: string): Deleted {
    return this.sql.tx(() => {
      const task = this.getTask(id);
      if (!task) throw new ValidationError("Task not found.");
      const labelIds = this.taskLabelIds(id);
      this.sql.run("DELETE FROM task WHERE id = ?", [id]);
      this.sql.run("UPDATE task SET position = position - 1 WHERE column_id = ? AND position > ?", [
        task.columnId,
        task.position,
      ]);
      return { kind: "task", task, labelIds };
    });
  }

  /** Undoes a deletion. Puts the task back at its old place (clamped if the column shrank). */
  restore(deleted: Deleted): void {
    this.sql.tx(() => {
      const t = deleted.task;
      if (!this.getBoard(t.boardId)) throw new ValidationError("Its board no longer exists.");
      const col = this.getColumn(t.columnId);
      if (!col) throw new ValidationError("Its column no longer exists.");
      const count = this.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM task WHERE column_id = ?", [t.columnId])!.n;
      const position = Math.min(t.position, count);
      this.sql.run("UPDATE task SET position = position + 1 WHERE column_id = ? AND position >= ?", [
        t.columnId,
        position,
      ]);
      const milestoneExists =
        t.milestoneId && this.sql.get("SELECT 1 AS x FROM milestone WHERE id = ?", [t.milestoneId]);
      this.sql.run(
        `INSERT INTO task (id, board_id, column_id, title, description, start_date, end_date, deadline,
                           milestone_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.boardId, t.columnId, t.title, t.description, t.startDate, t.endDate, t.deadline,
          milestoneExists ? t.milestoneId : null, position, t.createdAt, t.updatedAt],
      );
      for (const labelId of deleted.labelIds) {
        this.sql.run(
          "INSERT INTO task_label (task_id, label_id) SELECT ?, id FROM label WHERE id = ?",
          [t.id, labelId],
        );
      }
    });
  }
}
