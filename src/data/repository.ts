import type { Sql } from "../storage/sql";
import { isValidDate } from "../domain/dates";
import {
  ValidationError,
  type Board,
  type Column,
  type DateStr,
  type Label,
  type Milestone,
  type Task,
} from "../domain/types";
import { DEFAULT_NEAR_WINDOW, clampNearWindow } from "../domain/deadline";

/** The 8 fixed label colours (keys into tokens.css: --label-<key>). */
export const LABEL_COLORS = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "gray"] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

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
export type Deleted =
  | { kind: "task"; task: Task; labelIds: string[] }
  | { kind: "milestone"; milestone: Milestone; taskIds: string[] }
  | { kind: "label"; label: Label; taskIds: string[] };

export type MilestonePatch = Partial<Pick<Milestone, "title" | "description" | "date" | "isReached">>;
export type LabelPatch = Partial<Pick<Label, "name" | "color">>;

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

const toMilestone = (r: Row): Milestone => ({
  id: r.id,
  boardId: r.board_id,
  title: r.title,
  description: r.description,
  date: r.date,
  isReached: r.is_reached === 1,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toLabel = (r: Row): Label => ({ id: r.id, boardId: r.board_id, name: r.name, color: r.color });

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

  nearWindow(): number {
    const v = this.getSetting("near_window_days");
    return v === undefined ? DEFAULT_NEAR_WINDOW : clampNearWindow(Number(v));
  }

  setNearWindow(n: number): number {
    const v = clampNearWindow(n);
    this.setSetting("near_window_days", String(v));
    return v;
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

  renameBoard(id: string, name: string): Board {
    const clean = requireName(name, "Board name");
    return this.sql.tx(() => {
      if (!this.getBoard(id)) throw new ValidationError("Board not found.");
      this.sql.run("UPDATE board SET name = ?, updated_at = ? WHERE id = ?", [clean, this.stamp(), id]);
      return this.getBoard(id)!;
    });
  }

  moveBoard(id: string, toIndex: number): void {
    this.sql.tx(() => this.reorder("board", null, null, id, toIndex));
  }

  /** Deletes the board and everything on it (R4). Not undoable; covered by snapshots. */
  deleteBoard(id: string): void {
    this.sql.tx(() => {
      const b = this.getBoard(id);
      if (!b) throw new ValidationError("Board not found.");
      this.sql.run("DELETE FROM board WHERE id = ?", [id]);
      this.sql.run("UPDATE board SET position = position - 1 WHERE position > ?", [b.position]);
    });
  }

  /**
   * Moves row `id` to `toIndex` among rows sharing `scopeCol = scopeVal` (or the whole table),
   * then rewrites positions 0..n-1 (R6). Index is clamped.
   */
  private reorder(table: "board" | "board_column", scopeCol: string | null, scopeVal: string | null, id: string, toIndex: number): void {
    const where = scopeCol ? `WHERE ${scopeCol} = ?` : "";
    const ids = this.sql
      .all<{ id: string }>(`SELECT id FROM ${table} ${where} ORDER BY position`, scopeCol ? [scopeVal] : [])
      .map((r) => r.id);
    const from = ids.indexOf(id);
    if (from < 0) throw new ValidationError("Not found.");
    ids.splice(from, 1);
    ids.splice(Math.max(0, Math.min(Math.trunc(toIndex), ids.length)), 0, id);
    ids.forEach((rowId, i) => this.sql.run(`UPDATE ${table} SET position = ? WHERE id = ?`, [i, rowId]));
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

  addColumn(boardId: string, name: string): Column {
    const clean = requireName(name, "Column name");
    return this.sql.tx(() => {
      if (!this.getBoard(boardId)) throw new ValidationError("Board not found.");
      const id = this.newId();
      const position = this.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM board_column WHERE board_id = ?", [
        boardId,
      ])!.n;
      this.sql.run(
        "INSERT INTO board_column (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, 0)",
        [id, boardId, clean, position],
      );
      return this.getColumn(id)!;
    });
  }

  renameColumn(id: string, name: string): Column {
    const clean = requireName(name, "Column name");
    return this.sql.tx(() => {
      if (!this.getColumn(id)) throw new ValidationError("Column not found.");
      this.sql.run("UPDATE board_column SET name = ? WHERE id = ?", [clean, id]);
      return this.getColumn(id)!;
    });
  }

  setDoneColumn(id: string, isDone: boolean): Column {
    return this.sql.tx(() => {
      if (!this.getColumn(id)) throw new ValidationError("Column not found.");
      this.sql.run("UPDATE board_column SET is_done_column = ? WHERE id = ?", [isDone ? 1 : 0, id]);
      return this.getColumn(id)!;
    });
  }

  moveColumn(id: string, toIndex: number): void {
    this.sql.tx(() => {
      const col = this.getColumn(id);
      if (!col) throw new ValidationError("Column not found.");
      this.reorder("board_column", "board_id", col.boardId, id, toIndex);
    });
  }

  /** R5: only an empty column can be deleted. */
  deleteColumn(id: string): void {
    this.sql.tx(() => {
      const col = this.getColumn(id);
      if (!col) throw new ValidationError("Column not found.");
      const n = this.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM task WHERE column_id = ?", [id])!.n;
      if (n > 0) throw new ValidationError(`Move the ${n} task${n === 1 ? "" : "s"} out of “${col.name}” first.`);
      this.sql.run("DELETE FROM board_column WHERE id = ?", [id]);
      this.sql.run("UPDATE board_column SET position = position - 1 WHERE board_id = ? AND position > ?", [
        col.boardId,
        col.position,
      ]);
    });
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

  /** Undoes a deletion. */
  restore(deleted: Deleted): void {
    this.sql.tx(() => {
      if (deleted.kind === "task") this.restoreTask(deleted.task, deleted.labelIds);
      else if (deleted.kind === "milestone") this.restoreMilestone(deleted.milestone, deleted.taskIds);
      else this.restoreLabel(deleted.label, deleted.taskIds);
    });
  }

  /** Puts a task back at its old place (clamped if the column shrank). */
  private restoreTask(t: Task, labelIds: string[]): void {
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
    for (const labelId of labelIds) {
      this.sql.run("INSERT INTO task_label (task_id, label_id) SELECT ?, id FROM label WHERE id = ?", [t.id, labelId]);
    }
  }

  private restoreMilestone(m: Milestone, taskIds: string[]): void {
    if (!this.getBoard(m.boardId)) throw new ValidationError("Its board no longer exists.");
    this.sql.run(
      `INSERT INTO milestone (id, board_id, title, description, date, is_reached, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.boardId, m.title, m.description, m.date, m.isReached ? 1 : 0, m.createdAt, m.updatedAt],
    );
    for (const id of taskIds) {
      this.sql.run("UPDATE task SET milestone_id = ? WHERE id = ? AND milestone_id IS NULL", [m.id, id]);
    }
  }

  private restoreLabel(l: Label, taskIds: string[]): void {
    if (!this.getBoard(l.boardId)) throw new ValidationError("Its board no longer exists.");
    this.requireUniqueLabelName(l.boardId, l.name, null);
    this.sql.run("INSERT INTO label (id, board_id, name, color) VALUES (?, ?, ?, ?)", [l.id, l.boardId, l.name, l.color]);
    for (const id of taskIds) {
      this.sql.run("INSERT INTO task_label (task_id, label_id) SELECT id, ? FROM task WHERE id = ?", [l.id, id]);
    }
  }

  // ---------- milestones ----------

  listMilestones(boardId: string): Milestone[] {
    return this.sql
      .all<Row>("SELECT * FROM milestone WHERE board_id = ? ORDER BY date, title", [boardId])
      .map(toMilestone);
  }

  listAllMilestones(): Milestone[] {
    return this.sql.all<Row>("SELECT * FROM milestone ORDER BY date, title").map(toMilestone);
  }

  getMilestone(id: string): Milestone | undefined {
    const r = this.sql.get<Row>("SELECT * FROM milestone WHERE id = ?", [id]);
    return r && toMilestone(r);
  }

  createMilestone(boardId: string, title: string, date: DateStr, description = ""): Milestone {
    const clean = requireName(title, "Milestone title");
    const d = checkDate(date, "Milestone date");
    if (!d) throw new ValidationError("A milestone needs a date.");
    return this.sql.tx(() => {
      if (!this.getBoard(boardId)) throw new ValidationError("Board not found.");
      const id = this.newId();
      const now = this.stamp();
      this.sql.run(
        `INSERT INTO milestone (id, board_id, title, description, date, is_reached, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        [id, boardId, clean, description, d, now, now],
      );
      return this.getMilestone(id)!;
    });
  }

  updateMilestone(id: string, patch: MilestonePatch): Milestone {
    return this.sql.tx(() => {
      const m = this.getMilestone(id);
      if (!m) throw new ValidationError("Milestone not found.");
      let date = m.date;
      if (patch.date !== undefined) {
        const d = checkDate(patch.date, "Milestone date");
        if (!d) throw new ValidationError("A milestone needs a date.");
        date = d;
      }
      const next = {
        title: patch.title !== undefined ? requireName(patch.title, "Milestone title") : m.title,
        description: patch.description ?? m.description,
        date,
        isReached: patch.isReached ?? m.isReached,
      };
      this.sql.run(
        "UPDATE milestone SET title = ?, description = ?, date = ?, is_reached = ?, updated_at = ? WHERE id = ?",
        [next.title, next.description, next.date, next.isReached ? 1 : 0, this.stamp(), id],
      );
      return this.getMilestone(id)!;
    });
  }

  /** R4: linked tasks are unlinked, not deleted. */
  deleteMilestone(id: string): Deleted {
    return this.sql.tx(() => {
      const milestone = this.getMilestone(id);
      if (!milestone) throw new ValidationError("Milestone not found.");
      const taskIds = this.sql
        .all<{ id: string }>("SELECT id FROM task WHERE milestone_id = ? ORDER BY id", [id])
        .map((r) => r.id);
      this.sql.run("DELETE FROM milestone WHERE id = ?", [id]);
      return { kind: "milestone", milestone, taskIds };
    });
  }

  // ---------- labels ----------

  listLabels(boardId: string): Label[] {
    return this.sql
      .all<Row>("SELECT * FROM label WHERE board_id = ? ORDER BY name COLLATE NOCASE", [boardId])
      .map(toLabel);
  }

  listAllLabels(): Label[] {
    return this.sql.all<Row>("SELECT * FROM label ORDER BY name COLLATE NOCASE").map(toLabel);
  }

  getLabel(id: string): Label | undefined {
    const r = this.sql.get<Row>("SELECT * FROM label WHERE id = ?", [id]);
    return r && toLabel(r);
  }

  /** Every task→labels link on a board (or all boards), for rendering many cards at once. */
  labelsByTask(boardId: string | null): Map<string, Label[]> {
    const rows = this.sql.all<Row>(
      `SELECT tl.task_id, l.* FROM task_label tl JOIN label l ON l.id = tl.label_id
       ${boardId ? "WHERE l.board_id = ?" : ""} ORDER BY l.name COLLATE NOCASE`,
      boardId ? [boardId] : [],
    );
    const map = new Map<string, Label[]>();
    for (const r of rows) {
      const list = map.get(r.task_id) ?? [];
      list.push(toLabel(r));
      map.set(r.task_id, list);
    }
    return map;
  }

  private requireUniqueLabelName(boardId: string, name: string, exceptId: string | null): void {
    const clash = this.sql.get(
      "SELECT 1 AS x FROM label WHERE board_id = ? AND lower(trim(name)) = lower(trim(?)) AND id IS NOT ?",
      [boardId, name, exceptId],
    );
    if (clash) throw new ValidationError(`There is already a label called “${name.trim()}” on this board.`);
  }

  private checkColor(color: string): string {
    if (!(LABEL_COLORS as readonly string[]).includes(color)) throw new ValidationError("Unknown label colour.");
    return color;
  }

  createLabel(boardId: string, name: string, color: string): Label {
    const clean = requireName(name, "Label name");
    return this.sql.tx(() => {
      if (!this.getBoard(boardId)) throw new ValidationError("Board not found.");
      this.requireUniqueLabelName(boardId, clean, null);
      const id = this.newId();
      this.sql.run("INSERT INTO label (id, board_id, name, color) VALUES (?, ?, ?, ?)", [
        id,
        boardId,
        clean,
        this.checkColor(color),
      ]);
      return this.getLabel(id)!;
    });
  }

  updateLabel(id: string, patch: LabelPatch): Label {
    return this.sql.tx(() => {
      const l = this.getLabel(id);
      if (!l) throw new ValidationError("Label not found.");
      const name = patch.name !== undefined ? requireName(patch.name, "Label name") : l.name;
      this.requireUniqueLabelName(l.boardId, name, id);
      const color = patch.color !== undefined ? this.checkColor(patch.color) : l.color;
      this.sql.run("UPDATE label SET name = ?, color = ? WHERE id = ?", [name, color, id]);
      return this.getLabel(id)!;
    });
  }

  /** R4: removes the label from its tasks; the tasks stay. */
  deleteLabel(id: string): Deleted {
    return this.sql.tx(() => {
      const label = this.getLabel(id);
      if (!label) throw new ValidationError("Label not found.");
      const taskIds = this.sql
        .all<{ task_id: string }>("SELECT task_id FROM task_label WHERE label_id = ? ORDER BY task_id", [id])
        .map((r) => r.task_id);
      this.sql.run("DELETE FROM label WHERE id = ?", [id]);
      return { kind: "label", label, taskIds };
    });
  }

  /** Adds or removes one label on a task (R3: same board only). */
  setTaskLabel(taskId: string, labelId: string, on: boolean): void {
    this.sql.tx(() => {
      const t = this.getTask(taskId);
      const l = this.getLabel(labelId);
      if (!t || !l) throw new ValidationError("Task or label not found.");
      if (l.boardId !== t.boardId) throw new ValidationError("That label is not on this board.");
      if (on) this.sql.run("INSERT OR IGNORE INTO task_label (task_id, label_id) VALUES (?, ?)", [taskId, labelId]);
      else this.sql.run("DELETE FROM task_label WHERE task_id = ? AND label_id = ?", [taskId, labelId]);
      this.sql.run("UPDATE task SET updated_at = ? WHERE id = ?", [this.stamp(), taskId]);
    });
  }

  // ---------- cross-board reads (Timeline / Calendar "All boards") ----------

  listAllTasks(): Task[] {
    return this.sql
      .all<Row>(
        `SELECT t.* FROM task t JOIN board_column c ON c.id = t.column_id JOIN board b ON b.id = t.board_id
         ORDER BY b.position, c.position, t.position`,
      )
      .map(toTask);
  }

  /** Ids of every column marked as done (across all boards). */
  doneColumnIds(): Set<string> {
    return new Set(
      this.sql.all<{ id: string }>("SELECT id FROM board_column WHERE is_done_column = 1").map((r) => r.id),
    );
  }
}
