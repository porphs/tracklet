import { useState } from "react";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { statusClass } from "./status";
import { addMonths, calendarItems, monthGrid, monthStart, type CalendarItem } from "../domain/calendar";
import { deadlineStatus, statusBadge } from "../domain/deadline";
import type { DateStr } from "../domain/types";

export type Scope = "board" | "all";

interface Props {
  boardId: string;
  scope: Scope;
  labelFilter: string | null;
  onOpenTask: (id: string) => void;
  onOpenMilestone: (id: string) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_PER_DAY = 3;

/** Month view (Monday first) of task deadlines and milestones. */
export function CalendarView({ boardId, scope, labelFilter, onOpenTask, onOpenMilestone }: Props) {
  const store = useStore();
  const { attempt } = useNotices();
  const repo = store.repo;
  const today = store.today();
  const nearWindow = repo.nearWindow();
  const [month, setMonth] = useState<DateStr>(() => monthStart(today));
  const [expanded, setExpanded] = useState<DateStr | null>(null);

  const weeks = monthGrid(month);
  const all = scope === "all";
  const items = calendarItems({
    tasks: all ? repo.listAllTasks() : repo.listTasks(boardId),
    milestones: all ? repo.listAllMilestones() : repo.listMilestones(boardId),
    doneColumnIds: repo.doneColumnIds(),
    labelsByTask: repo.labelsByTask(all ? null : boardId),
    labelFilter,
    from: weeks[0][0],
    to: weeks[weeks.length - 1][6],
  });
  const boardNames = new Map(repo.listBoards().map((b) => [b.id, b.name]));
  const monthLabel = new Date(`${month}T12:00:00`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const createOn = (day: DateStr) => {
    const first = repo.listColumns(boardId)[0];
    if (!first) return attempt(() => {
      throw new Error("This board has no columns to add a task to.");
    });
    let id = "";
    if (attempt(() => (id = store.mutate((r) => r.createTask({ boardId, columnId: first.id, title: "New task", deadline: day })).id))) {
      onOpenTask(id);
    }
  };

  const itemView = (item: CalendarItem) => {
    const prefix = all ? `${boardNames.get(item.boardId)}: ` : "";
    if (item.kind === "milestone") {
      const m = item.milestone;
      const info = deadlineStatus(m.date, today, nearWindow, m.isReached);
      return (
        <button
          key={`m-${m.id}`}
          className={`cal-item cal-milestone${statusClass(info.status)}${m.isReached ? " done" : ""}`}
          title={`Milestone: ${m.title}${statusBadge(info) ? ` (${statusBadge(info)})` : ""}`}
          onClick={() => onOpenMilestone(m.id)}
        >
          ◆ {statusBadge(info) && <span className="cal-badge">{statusBadge(info)} · </span>}
          {prefix}
          {m.title}
        </button>
      );
    }
    const t = item.task;
    const info = deadlineStatus(t.deadline, today, nearWindow, item.done);
    const badge = statusBadge(info);
    return (
      <button
        key={`t-${t.id}`}
        className={`cal-item${statusClass(info.status)}${item.done ? " done" : ""}`}
        title={`${t.title}${badge ? ` (${badge})` : ""}`}
        onClick={() => onOpenTask(t.id)}
      >
        {badge && <span className="cal-badge">{badge} · </span>}
        {prefix}
        {t.title}
      </button>
    );
  };

  return (
    <div className="calendar">
      <div className="row cal-toolbar">
        <button onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">
          ‹
        </button>
        <button onClick={() => setMonth(monthStart(today))}>Today</button>
        <button onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">
          ›
        </button>
        <h2 className="cal-title">{monthLabel}</h2>
        <span className="muted">Double-click a day to add a task due that day.</span>
      </div>
      <div className="cal-grid" role="grid" aria-label={monthLabel}>
        {WEEKDAYS.map((d) => (
          <div key={d} className="cal-weekday" role="columnheader">
            {d}
          </div>
        ))}
        {weeks.flat().map((day) => {
          const list = items.get(day) ?? [];
          const open = expanded === day;
          const shown = open ? list : list.slice(0, MAX_PER_DAY);
          return (
            <div
              key={day}
              role="gridcell"
              data-date={day}
              className={`cal-day${day.slice(0, 7) !== month.slice(0, 7) ? " other-month" : ""}${day === today ? " today" : ""}`}
              onDoubleClick={(e) => {
                if ((e.target as HTMLElement).closest("button")) return;
                createOn(day);
              }}
            >
              <div className="cal-date">{Number(day.slice(8))}</div>
              {shown.map(itemView)}
              {list.length > MAX_PER_DAY && (
                <button className="link-button cal-more" onClick={() => setExpanded(open ? null : day)}>
                  {open ? "Show less" : `+${list.length - MAX_PER_DAY} more`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
