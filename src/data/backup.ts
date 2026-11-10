import type { Sql } from "../storage/sql";
import { isValidDate } from "../domain/dates";
import { LABEL_COLORS } from "./repository";

/**
 * JSON export / replace-only import (ADR 0002). The export is a plain, readable snapshot of
 * every table. Import validates everything first and changes nothing if anything is wrong.
 */
export const FORMAT_VERSION = 1;

export interface ExportData {
  boards: { id: string; name: string; position: number; createdAt: string; updatedAt: string }[];
  columns: { id: string; boardId: string; name: string; position: number; isDoneColumn: boolean }[];
  milestones: {
    id: string;
    boardId: string;
    title: string;
    description: string;
    date: string;
    isReached: boolean;
    createdAt: string;
    updatedAt: string;
  }[];
  tasks: {
    id: string;
    boardId: string;
    columnId: string;
    title: string;
    description: string;
    startDate: string | null;
    endDate: string | null;
    deadline: string | null;
    milestoneId: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
  }[];
  labels: { id: string; boardId: string; name: string; color: string }[];
  taskLabels: { taskId: string; labelId: string }[];
  settings: Record<string, string>;
}

export interface ExportFile {
  app: "tracklet";
  formatVersion: number;
  exportedAt: string;
  data: ExportData;
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportError";
  }
}

/** Settings that describe this machine's window, not the user's data. */
const LOCAL_SETTINGS = new Set(["window_bounds"]);

export function exportData(sql: Sql): ExportData {
  const rows = (q: string) => sql.all<Record<string, any>>(q);
  return {
    boards: rows("SELECT * FROM board ORDER BY position, id").map((r) => ({
      id: r.id,
      name: r.name,
      position: r.position,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    columns: rows("SELECT * FROM board_column ORDER BY board_id, position, id").map((r) => ({
      id: r.id,
      boardId: r.board_id,
      name: r.name,
      position: r.position,
      isDoneColumn: r.is_done_column === 1,
    })),
    milestones: rows("SELECT * FROM milestone ORDER BY board_id, date, id").map((r) => ({
      id: r.id,
      boardId: r.board_id,
      title: r.title,
      description: r.description,
      date: r.date,
      isReached: r.is_reached === 1,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    tasks: rows("SELECT * FROM task ORDER BY board_id, column_id, position, id").map((r) => ({
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
    })),
    labels: rows("SELECT * FROM label ORDER BY board_id, name, id").map((r) => ({
      id: r.id,
      boardId: r.board_id,
      name: r.name,
      color: r.color,
    })),
    taskLabels: rows("SELECT * FROM task_label ORDER BY task_id, label_id").map((r) => ({
      taskId: r.task_id,
      labelId: r.label_id,
    })),
    settings: Object.fromEntries(
      rows("SELECT key, value FROM setting ORDER BY key")
        .filter((r) => !LOCAL_SETTINGS.has(r.key))
        .map((r) => [r.key, r.value]),
    ),
  };
}

export function serializeExport(sql: Sql, now: Date): string {
  const file: ExportFile = { app: "tracklet", formatVersion: FORMAT_VERSION, exportedAt: now.toISOString(), data: exportData(sql) };
  return JSON.stringify(file, null, 2);
}

export function exportFileName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `tracklet-export-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.json`
  );
}

// ---------- format upgrades ----------

/**
 * One step per old format version, turning version N into N+1. Empty while only v1 exists;
 * when the format changes, add `1: (data) => ...` here and bump FORMAT_VERSION.
 */
const UPGRADES: Record<number, (data: any) => any> = {};

export function upgradeToCurrent(version: number, data: unknown): unknown {
  let d = data;
  for (let v = version; v < FORMAT_VERSION; v++) {
    const step = UPGRADES[v];
    if (!step) throw new ImportError(`Cannot upgrade an export from format version ${v}.`);
    d = step(d);
  }
  return d;
}

// ---------- validation ----------

type Obj = Record<string, unknown>;

function fail(msg: string): never {
  throw new ImportError(msg);
}

function isObj(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function arr(data: Obj, key: string): Obj[] {
  const v = data[key];
  if (!Array.isArray(v)) fail(`“${key}” is missing or not a list.`);
  v.forEach((x, i) => isObj(x) || fail(`${key}[${i}] is not an object.`));
  return v as Obj[];
}

function str(o: Obj, key: string, where: string, { nonEmpty = false } = {}): string {
  const v = o[key];
  if (typeof v !== "string") fail(`${where}: “${key}” must be text.`);
  if (nonEmpty && !v.trim()) fail(`${where}: “${key}” cannot be empty.`);
  return v;
}

function optDate(o: Obj, key: string, where: string): string | null {
  const v = o[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" || !isValidDate(v)) fail(`${where}: “${key}” must be a date (YYYY-MM-DD) or null.`);
  return v;
}

function int(o: Obj, key: string, where: string): number {
  const v = o[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(`${where}: “${key}” must be a whole number.`);
  return v;
}

function bool(o: Obj, key: string, where: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") fail(`${where}: “${key}” must be true or false.`);
  return v;
}

/** Parses and fully validates an export file. Throws ImportError with a readable reason. */
export function parseImport(text: string): ExportData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("This file is not valid JSON.");
  }
  if (!isObj(raw)) fail("This file is not a Tracklet export.");
  if (raw.app !== "tracklet") fail("This file is not a Tracklet export.");
  const version = raw.formatVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) fail("The file has no valid format version.");
  if (version > FORMAT_VERSION)
    fail(`This export is from a newer version of Tracklet (format ${version}; this app reads up to ${FORMAT_VERSION}).`);
  const data = upgradeToCurrent(version, raw.data);
  if (!isObj(data)) fail("The file has no data section.");

  const ids = new Set<string>();
  const uniqueId = (o: Obj, where: string) => {
    const id = str(o, "id", where, { nonEmpty: true });
    if (ids.has(id)) fail(`${where}: id “${id}” is used more than once.`);
    ids.add(id);
    return id;
  };

  const boards = arr(data, "boards").map((o, i) => {
    const w = `boards[${i}]`;
    return {
      id: uniqueId(o, w),
      name: str(o, "name", w, { nonEmpty: true }).trim(),
      position: int(o, "position", w),
      createdAt: str(o, "createdAt", w),
      updatedAt: str(o, "updatedAt", w),
    };
  });
  const boardIds = new Set(boards.map((b) => b.id));
  const needBoard = (id: string, w: string) => boardIds.has(id) || fail(`${w}: board “${id}” does not exist.`);

  const columns = arr(data, "columns").map((o, i) => {
    const w = `columns[${i}]`;
    const c = {
      id: uniqueId(o, w),
      boardId: str(o, "boardId", w),
      name: str(o, "name", w, { nonEmpty: true }).trim(),
      position: int(o, "position", w),
      isDoneColumn: bool(o, "isDoneColumn", w),
    };
    needBoard(c.boardId, w);
    return c;
  });
  const columnBoard = new Map(columns.map((c) => [c.id, c.boardId]));

  const milestones = arr(data, "milestones").map((o, i) => {
    const w = `milestones[${i}]`;
    const date = optDate(o, "date", w);
    if (!date) fail(`${w}: a milestone needs a date.`);
    const m = {
      id: uniqueId(o, w),
      boardId: str(o, "boardId", w),
      title: str(o, "title", w, { nonEmpty: true }).trim(),
      description: str(o, "description", w),
      date,
      isReached: bool(o, "isReached", w),
      createdAt: str(o, "createdAt", w),
      updatedAt: str(o, "updatedAt", w),
    };
    needBoard(m.boardId, w);
    return m;
  });
  const milestoneBoard = new Map(milestones.map((m) => [m.id, m.boardId]));

  const tasks = arr(data, "tasks").map((o, i) => {
    const w = `tasks[${i}]`;
    const milestoneId = o.milestoneId === null || o.milestoneId === undefined ? null : str(o, "milestoneId", w);
    const t = {
      id: uniqueId(o, w),
      boardId: str(o, "boardId", w),
      columnId: str(o, "columnId", w),
      title: str(o, "title", w, { nonEmpty: true }).trim(),
      description: str(o, "description", w),
      startDate: optDate(o, "startDate", w),
      endDate: optDate(o, "endDate", w),
      deadline: optDate(o, "deadline", w),
      milestoneId,
      position: int(o, "position", w),
      createdAt: str(o, "createdAt", w),
      updatedAt: str(o, "updatedAt", w),
    };
    needBoard(t.boardId, w);
    if (columnBoard.get(t.columnId) !== t.boardId) fail(`${w}: column “${t.columnId}” is missing or on another board.`);
    if (t.milestoneId && milestoneBoard.get(t.milestoneId) !== t.boardId)
      fail(`${w}: milestone “${t.milestoneId}” is missing or on another board.`);
    if (t.startDate && t.endDate && t.endDate < t.startDate) fail(`${w}: end date is before start date.`);
    return t;
  });
  const taskBoard = new Map(tasks.map((t) => [t.id, t.boardId]));

  const labelNames = new Set<string>();
  const labels = arr(data, "labels").map((o, i) => {
    const w = `labels[${i}]`;
    const l = {
      id: uniqueId(o, w),
      boardId: str(o, "boardId", w),
      name: str(o, "name", w, { nonEmpty: true }).trim(),
      color: str(o, "color", w),
    };
    needBoard(l.boardId, w);
    if (!(LABEL_COLORS as readonly string[]).includes(l.color)) fail(`${w}: unknown colour “${l.color}”.`);
    const key = `${l.boardId}\u0000${l.name.toLowerCase()}`;
    if (labelNames.has(key)) fail(`${w}: there are two labels called “${l.name}” on one board.`);
    labelNames.add(key);
    return l;
  });
  const labelBoard = new Map(labels.map((l) => [l.id, l.boardId]));

  const seenLinks = new Set<string>();
  const taskLabels = arr(data, "taskLabels").map((o, i) => {
    const w = `taskLabels[${i}]`;
    const tl = { taskId: str(o, "taskId", w), labelId: str(o, "labelId", w) };
    const tb = taskBoard.get(tl.taskId);
    if (!tb) fail(`${w}: task “${tl.taskId}” does not exist.`);
    if (labelBoard.get(tl.labelId) !== tb) fail(`${w}: label “${tl.labelId}” is missing or on another board.`);
    const k = `${tl.taskId}|${tl.labelId}`;
    if (seenLinks.has(k)) fail(`${w}: duplicate label link.`);
    seenLinks.add(k);
    return tl;
  });

  const settingsRaw = data.settings ?? {};
  if (!isObj(settingsRaw)) fail("“settings” must be an object.");
  const settings: Record<string, string> = {};
  for (const [k, v] of Object.entries(settingsRaw)) {
    if (typeof v !== "string") fail(`settings.${k} must be text.`);
    if (!LOCAL_SETTINGS.has(k)) settings[k] = v;
  }

  return { boards, columns, milestones, tasks, labels, taskLabels, settings };
}

/** Rewrites positions 0..n-1 within each group, keeping their order (R6). */
function renumber<T extends { position: number }>(items: T[], group: (t: T) => string): T[] {
  const byGroup = new Map<string, T[]>();
  for (const it of items) byGroup.set(group(it), [...(byGroup.get(group(it)) ?? []), it]);
  const out: T[] = [];
  for (const list of byGroup.values()) {
    list.sort((a, b) => a.position - b.position).forEach((it, i) => out.push({ ...it, position: i }));
  }
  return out;
}

/** Replaces ALL data with `data` in one transaction. Call only with the result of parseImport. */
export function applyImport(sql: Sql, data: ExportData): void {
  sql.tx(() => {
    const windowBounds = sql.get<{ value: string }>("SELECT value FROM setting WHERE key = 'window_bounds'");
    for (const t of ["task_label", "task", "label", "milestone", "board_column", "board", "setting"]) {
      sql.run(`DELETE FROM ${t}`);
    }
    for (const b of renumber(data.boards, () => "")) {
      sql.run("INSERT INTO board (id, name, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
        b.id, b.name, b.position, b.createdAt, b.updatedAt,
      ]);
    }
    for (const c of renumber(data.columns, (c) => c.boardId)) {
      sql.run("INSERT INTO board_column (id, board_id, name, position, is_done_column) VALUES (?, ?, ?, ?, ?)", [
        c.id, c.boardId, c.name, c.position, c.isDoneColumn ? 1 : 0,
      ]);
    }
    for (const m of data.milestones) {
      sql.run(
        `INSERT INTO milestone (id, board_id, title, description, date, is_reached, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [m.id, m.boardId, m.title, m.description, m.date, m.isReached ? 1 : 0, m.createdAt, m.updatedAt],
      );
    }
    for (const t of renumber(data.tasks, (t) => t.columnId)) {
      sql.run(
        `INSERT INTO task (id, board_id, column_id, title, description, start_date, end_date, deadline,
                           milestone_id, position, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [t.id, t.boardId, t.columnId, t.title, t.description, t.startDate, t.endDate, t.deadline, t.milestoneId,
          t.position, t.createdAt, t.updatedAt],
      );
    }
    for (const l of data.labels) {
      sql.run("INSERT INTO label (id, board_id, name, color) VALUES (?, ?, ?, ?)", [l.id, l.boardId, l.name, l.color]);
    }
    for (const tl of data.taskLabels) {
      sql.run("INSERT INTO task_label (task_id, label_id) VALUES (?, ?)", [tl.taskId, tl.labelId]);
    }
    for (const [k, v] of Object.entries(data.settings)) {
      sql.run("INSERT INTO setting (key, value) VALUES (?, ?)", [k, v]);
    }
    if (windowBounds) sql.run("INSERT INTO setting (key, value) VALUES ('window_bounds', ?)", [windowBounds.value]);
  });
}

export function importSummary(data: ExportData): string {
  return `${data.boards.length} board(s), ${data.tasks.length} task(s), ${data.milestones.length} milestone(s), ${data.labels.length} label(s)`;
}
