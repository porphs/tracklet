import { useLayoutEffect, useRef, useState } from "react";
import { useStore } from "./useStore";
import { statusClass } from "./status";
import type { Scope } from "./CalendarView";
import {
  PX_PER_DAY,
  barGeometry,
  buildTimeline,
  dateToX,
  ticks,
  totalDays,
  visibleRange,
  xToDate,
  type TimelineTask,
  type Zoom,
} from "../domain/timeline";
import { deadlineStatus, statusBadge } from "../domain/deadline";
import type { DateStr } from "../domain/types";

interface Props {
  boardId: string;
  scope: Scope;
  labelFilter: string | null;
  onOpenTask: (id: string) => void;
  onOpenMilestone: (id: string) => void;
}

const LABEL_WIDTH = 240; // keep in sync with --timeline-label-width in tokens.css
const ZOOMS: Zoom[] = ["day", "week", "month"];

/** Gantt-style view. Read-only drawing; click anything to edit it in the panel. */
export function TimelineView({ boardId, scope, labelFilter, onOpenTask, onOpenMilestone }: Props) {
  const store = useStore();
  const repo = store.repo;
  const today = store.today();
  const nearWindow = repo.nearWindow();
  const [zoom, setZoom] = useState<Zoom>(() => (repo.getSetting("timeline_zoom") as Zoom) || "week");
  const scroller = useRef<HTMLDivElement>(null);
  // The date to centre on after the next render (initial load, zoom change, "Today").
  const pendingCentre = useRef<DateStr | null>(today);

  const all = scope === "all";
  const sections = buildTimeline({
    boards: all ? repo.listBoards() : repo.listBoards().filter((b) => b.id === boardId),
    tasks: all ? repo.listAllTasks() : repo.listTasks(boardId),
    milestones: all ? repo.listAllMilestones() : repo.listMilestones(boardId),
    doneColumnIds: repo.doneColumnIds(),
    labelsByTask: repo.labelsByTask(all ? null : boardId),
    labelFilter,
  });
  const range = visibleRange(sections, today, zoom);
  const width = totalDays(range) * PX_PER_DAY[zoom];
  const px = PX_PER_DAY[zoom];
  const x = (d: DateStr) => dateToX(d, range, zoom);

  useLayoutEffect(() => {
    const el = scroller.current;
    const centre = pendingCentre.current;
    if (!el || !centre) return;
    pendingCentre.current = null;
    const visible = el.clientWidth - LABEL_WIDTH;
    el.scrollLeft = Math.max(0, x(centre) + px / 2 - visible / 2);
  });

  const centreDate = (): DateStr => {
    const el = scroller.current;
    if (!el) return today;
    return xToDate(el.scrollLeft + (el.clientWidth - LABEL_WIDTH) / 2, range, zoom);
  };

  const changeZoom = (z: Zoom) => {
    pendingCentre.current = centreDate();
    setZoom(z);
    store.mutate((r) => r.setSetting("timeline_zoom", z));
  };

  const taskRow = (row: TimelineTask) => {
    const t = row.task;
    const info = deadlineStatus(t.deadline, today, nearWindow, row.done);
    const badge = statusBadge(info);
    const cls = `${statusClass(info.status)}${row.done ? " done" : ""}`;
    const geo = row.bar && barGeometry(row.bar, range, zoom);
    return (
      <div className="tl-row" key={t.id} data-task-id={t.id}>
        <button className={`tl-label${cls}`} onClick={() => onOpenTask(t.id)} title={t.title}>
          {badge && <span className="cal-badge">{badge} · </span>}
          {t.title}
        </button>
        <div className="tl-track" style={{ width }}>
          {geo && (
            <button
              className={`tl-bar${cls}`}
              style={{ left: geo.x, width: geo.width }}
              title={`${t.title}: ${row.bar!.start} → ${row.bar!.end}${t.deadline ? `, deadline ${t.deadline}` : ""}`}
              aria-label={`Bar ${t.title}`}
              onClick={() => onOpenTask(t.id)}
            />
          )}
          {t.deadline && (
            <button
              className={`tl-deadline${cls}${geo ? "" : " solo"}`}
              style={{ left: x(t.deadline) + px / 2 }}
              title={`Deadline ${t.deadline}${badge ? ` (${badge})` : ""}`}
              aria-label={`Deadline ${t.title}`}
              onClick={() => onOpenTask(t.id)}
            />
          )}
        </div>
      </div>
    );
  };

  const empty = sections.every((s) => s.groups.length === 0);

  return (
    <div className="timeline">
      <div className="row cal-toolbar">
        <div className="scope" role="radiogroup" aria-label="Zoom">
          {ZOOMS.map((z) => (
            <button
              key={z}
              role="radio"
              aria-checked={zoom === z}
              className={`tab${zoom === z ? " active" : ""}`}
              onClick={() => changeZoom(z)}
            >
              {z[0].toUpperCase() + z.slice(1)}
            </button>
          ))}
        </div>
        <button
          onClick={() => {
            pendingCentre.current = today;
            store.refresh();
          }}
        >
          Today
        </button>
        <span className="muted">Tasks without dates are not shown. Click a bar to edit it.</span>
      </div>

      {empty ? (
        <p className="muted">Nothing to show yet: give tasks a start/end date or a deadline, or add a milestone.</p>
      ) : (
        <div className="tl-scroller" ref={scroller} data-range-start={range.start}>
          <div className="tl-inner" style={{ width: LABEL_WIDTH + width }}>
            <div className="tl-row tl-header">
              <div className="tl-label tl-corner" />
              <div className="tl-track" style={{ width }}>
                {ticks(range, zoom).map((tk) => (
                  <div key={tk.date} className="tl-tick" style={{ left: tk.x }}>
                    {tk.label}
                  </div>
                ))}
              </div>
            </div>

            {sections.map((section) => (
              <div key={section.board.id}>
                {all && (
                  <div className="tl-row tl-board">
                    <div className="tl-label">{section.board.name}</div>
                    <div className="tl-track" style={{ width }} />
                  </div>
                )}
                {section.groups.map((g) => {
                  const m = g.milestone;
                  const info = m ? deadlineStatus(m.date, today, nearWindow, m.isReached) : null;
                  return (
                    <div key={g.key} className="tl-group">
                      <div className="tl-row tl-group-header">
                        {m ? (
                          <button
                            className={`tl-label tl-milestone-label${statusClass(info!.status)}${m.isReached ? " done" : ""}`}
                            onClick={() => onOpenMilestone(m.id)}
                          >
                            ◆ {statusBadge(info!) && <span className="cal-badge">{statusBadge(info!)} · </span>}
                            {m.title}
                          </button>
                        ) : (
                          <div className="tl-label muted">No milestone</div>
                        )}
                        <div className="tl-track" style={{ width }}>
                          {m && (
                            <button
                              className={`tl-diamond${statusClass(info!.status)}${m.isReached ? " done" : ""}`}
                              style={{ left: x(m.date) + px / 2 }}
                              title={`Milestone ${m.title}: ${m.date}`}
                              aria-label={`Milestone ${m.title}`}
                              onClick={() => onOpenMilestone(m.id)}
                            />
                          )}
                        </div>
                      </div>
                      {g.tasks.map(taskRow)}
                    </div>
                  );
                })}
              </div>
            ))}

            <div className="tl-today" style={{ left: LABEL_WIDTH + x(today) + px / 2 }} title={`Today ${today}`} />
          </div>
        </div>
      )}
    </div>
  );
}
