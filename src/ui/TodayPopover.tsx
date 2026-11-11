import { useCallback, useEffect, useState } from "react";
import type { SqlJsConfig } from "sql.js";
import { Repository } from "../data/repository";
import { toLocalDate } from "../domain/dates";
import { tasksForToday, type TodaySection } from "../domain/today";
import type { DateStr } from "../domain/types";
import { LATEST_VERSION, currentVersion } from "../storage/migrations";
import { openDatabase } from "../storage/open";
import type { Persistence } from "../storage/persistence";
import { DeadlineBadge, shortDate } from "./status";

interface Snapshot {
  today: DateStr;
  nearWindow: number;
  sections: TodaySection[];
}

/**
 * Reads the saved database and picks out today's tasks. Read-only: the popover never
 * migrates, snapshots or saves; the main window owns the data.
 */
async function loadSnapshot(persistence: Persistence, sqlConfig?: SqlJsConfig): Promise<Snapshot> {
  const sql = await openDatabase(await persistence.load(), sqlConfig);
  if (currentVersion(sql) !== LATEST_VERSION) throw new Error("Open Tracklet once to update your data.");
  const repo = new Repository(sql);
  const today = toLocalDate(new Date());
  return {
    today,
    nearWindow: repo.nearWindow(),
    sections: tasksForToday({
      boards: repo.listBoards(),
      tasks: repo.listAllTasks(),
      columns: repo.listAllColumns(),
      today,
    }),
  };
}

function spanText(start: DateStr, end: DateStr, today: DateStr): string {
  if (start === end) return "Today only";
  if (end === today) return `${shortDate(start, today)} – ends today`;
  return `${shortDate(start, today)} – ${shortDate(end, today)}`;
}

export function TodayPopover({
  persistence,
  sqlConfig,
  onOpenTask,
  onClose,
}: {
  persistence: Persistence;
  sqlConfig?: SqlJsConfig;
  onOpenTask: (id: string) => void;
  onClose: () => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    loadSnapshot(persistence, sqlConfig).then(
      (s) => {
        setSnap(s);
        setError(null);
      },
      (e) => setError(e instanceof Error ? e.message : String(e)),
    );
  }, [persistence, sqlConfig]);

  // The window stays alive while hidden, so reload every time it is shown (it gets focus).
  useEffect(() => {
    reload();
    window.addEventListener("focus", reload);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", reload);
      window.removeEventListener("keydown", onKey);
    };
  }, [reload, onClose]);

  const count = snap?.sections.reduce((n, s) => n + s.tasks.length, 0) ?? 0;
  const heading = snap
    ? new Date(`${snap.today}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
    : "";

  return (
    <div className="today">
      <header className="today-header">
        <div>
          <h1>Today</h1>
          <span className="muted">{heading}</span>
        </div>
        {snap && <span className="today-count">{count === 1 ? "1 task" : `${count} tasks`}</span>}
      </header>

      <div className="today-list">
        {error && (
          <p className="today-empty" role="alert">
            {error}
          </p>
        )}
        {snap && !error && count === 0 && <p className="today-empty">Nothing planned for today.</p>}
        {snap &&
          !error &&
          snap.sections.map((section) => (
            <section key={section.board.id} className="today-section">
              <h2 className="sidebar-heading">{section.board.name}</h2>
              {section.tasks.map(({ task, column, start, end }) => (
                <button key={task.id} className="today-task" onClick={() => onOpenTask(task.id)}>
                  <span className="today-title">{task.title}</span>
                  <span className="today-meta">
                    <span className={end === snap.today ? "today-ends" : ""}>{spanText(start, end, snap.today)}</span>
                    {column && <span>· {column.name}</span>}
                    <DeadlineBadge date={task.deadline} today={snap.today} nearWindow={snap.nearWindow} closed={false} />
                  </span>
                </button>
              ))}
            </section>
          ))}
      </div>

      <footer className="today-footer">
        <span className="muted">Tasks whose planned dates include today</span>
      </footer>
    </div>
  );
}
