import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { shortDate, statusClass } from "./status";
import type { Scope } from "./CalendarView";
import {
  PX_PER_DAY,
  barGeometry,
  buildTimeline,
  dateToX,
  dayDelta,
  dragPlannedDates,
  ticks,
  totalDays,
  visibleRange,
  xToDate,
  type BarDrag,
  type TimelineTask,
  type Zoom,
} from "../domain/timeline";
import { deadlineStatus, statusBadge } from "../domain/deadline";
import { addDays, daysBetween } from "../domain/dates";
import type { DateStr, Milestone, Task } from "../domain/types";

interface Props {
  boardId: string;
  scope: Scope;
  labelFilter: string | null;
  onOpenTask: (id: string) => void;
  onOpenMilestone: (id: string) => void;
}

const LABEL_WIDTH = 280; // keep in sync with --timeline-label-width in tokens.css
const ZOOMS: Zoom[] = ["day", "week", "month"];
/** A press that moves less than this is a click (spec slice 8). */
const DRAG_THRESHOLD_PX = 4;
/** Bars narrower than this get no resize ends; they can only be moved. */
const MIN_RESIZE_WIDTH_PX = 24;

type DragTarget =
  | { kind: BarDrag; taskId: string }
  | { kind: "deadline"; taskId: string }
  | { kind: "milestone"; milestoneId: string };

interface DragState {
  target: DragTarget;
  startX: number;
  delta: number;
  moved: boolean;
}

/** Gantt-style view. Drag bars, their ends, deadlines and diamonds to change dates; click to edit. */
export function TimelineView({ boardId, scope, labelFilter, onOpenTask, onOpenMilestone }: Props) {
  const store = useStore();
  const { attempt } = useNotices();
  const repo = store.repo;
  const today = store.today();
  const nearWindow = repo.nearWindow();
  const [zoom, setZoom] = useState<Zoom>(() => (repo.getSetting("timeline_zoom") as Zoom) || "week");
  const scroller = useRef<HTMLDivElement>(null);
  // The date to centre on after the next render (initial load, zoom change, "Today").
  const pendingCentre = useRef<DateStr | null>(today);
  // The range start drawn last time, so the view does not jump when a drag grows the range.
  const drawnStart = useRef<DateStr | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  // The click that ends a drag must not also open the editor.
  const suppressClick = useRef(false);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [panning, setPanning] = useState(false);

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
    if (!el) return;
    const centre = pendingCentre.current;
    if (centre) {
      pendingCentre.current = null;
      const visible = el.clientWidth - LABEL_WIDTH;
      el.scrollLeft = Math.max(0, x(centre) + px / 2 - visible / 2);
    } else if (drawnStart.current && drawnStart.current !== range.start) {
      el.scrollLeft += daysBetween(range.start, drawnStart.current) * px;
    }
    drawnStart.current = range.start;
  });

  // Esc cancels a drag in progress (spec slice 8).
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      suppressClick.current = true;
      setDrag(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

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

  const tasksById = new Map<string, Task>();
  const milestonesById = new Map<string, Milestone>();
  for (const s of sections)
    for (const g of s.groups) {
      if (g.milestone) milestonesById.set(g.milestone.id, g.milestone);
      for (const row of g.tasks) tasksById.set(row.task.id, row.task);
    }

  const commit = (d: DragState) => {
    if (d.delta === 0) return;
    const t = d.target;
    if (t.kind === "milestone") {
      const m = milestonesById.get(t.milestoneId);
      if (m) attempt(() => store.mutate((r) => r.updateMilestone(m.id, { date: addDays(m.date, d.delta) })));
      return;
    }
    const task = tasksById.get(t.taskId);
    if (!task) return;
    if (t.kind === "deadline") {
      if (task.deadline) attempt(() => store.mutate((r) => r.updateTask(task.id, { deadline: addDays(task.deadline!, d.delta) })));
      return;
    }
    const next = dragPlannedDates(task, t.kind, d.delta);
    if (next.startDate !== task.startDate || next.endDate !== task.endDate) {
      attempt(() => store.mutate((r) => r.updateTask(task.id, next)));
    }
  };

  /** Pointer handlers that turn a press into either a click (`onActivate`) or a date drag. */
  const draggable = (target: DragTarget, onActivate: () => void) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation(); // not a pan, and not the bar under a resize end
      e.currentTarget.setPointerCapture(e.pointerId);
      suppressClick.current = false;
      setDrag({ target, startX: e.clientX, delta: 0, moved: false });
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      if (!drag || !sameTarget(drag.target, target)) return;
      const dx = e.clientX - drag.startX;
      const moved = drag.moved || Math.abs(dx) >= DRAG_THRESHOLD_PX;
      const delta = moved ? dayDelta(dx, zoom) : 0;
      if (moved !== drag.moved || delta !== drag.delta) setDrag({ ...drag, moved, delta });
    },
    onPointerUp: () => {
      if (!drag || !sameTarget(drag.target, target)) return;
      setDrag(null);
      if (drag.moved) {
        suppressClick.current = true;
        commit(drag);
      }
    },
    onPointerCancel: () => setDrag(null),
    onClick: (e: ReactMouseEvent) => {
      e.stopPropagation(); // a click on a resize end must not reach the bar twice
      if (suppressClick.current) {
        suppressClick.current = false;
        return;
      }
      onActivate();
    },
  });

  const isDragging = (target: DragTarget) => !!drag?.moved && sameTarget(drag.target, target);
  const deltaFor = (target: DragTarget) => (drag && drag.moved && sameTarget(drag.target, target) ? drag.delta : 0);
  const draggingClass = (target: DragTarget) => (isDragging(target) ? " dragging" : "");

  const taskRow = (row: TimelineTask) => {
    const t = row.task;
    const info = deadlineStatus(t.deadline, today, nearWindow, row.done);
    const badge = statusBadge(info);
    const cls = `${statusClass(info.status)}${row.done ? " done" : ""}`;

    // While a bar (or one of its ends) is dragged, draw the dates it would get.
    const barKind = drag?.moved && "taskId" in drag.target && drag.target.taskId === t.id && drag.target.kind !== "deadline" ? drag.target.kind : null;
    const planned = barKind ? dragPlannedDates(t, barKind, drag!.delta) : t;
    const bar = row.bar && {
      start: (planned.startDate ?? planned.endDate)!,
      end: (planned.endDate ?? planned.startDate)!,
    };
    const geo = bar && barGeometry(bar, range, zoom);
    const barTarget = (kind: BarDrag): DragTarget => ({ kind, taskId: t.id });
    const deadlineTarget: DragTarget = { kind: "deadline", taskId: t.id };
    const deadline = t.deadline && addDays(t.deadline, deltaFor(deadlineTarget));

    return (
      <div className="tl-row" key={t.id} data-task-id={t.id}>
        <button className={`tl-label${cls}`} onClick={() => onOpenTask(t.id)} title={t.title}>
          {badge && <span className="cal-badge">{badge} · </span>}
          {t.title}
        </button>
        <div className="tl-track" style={{ width }}>
          {geo && bar && (
            <button
              className={`tl-bar${cls}${barKind ? " dragging" : ""}`}
              style={{ left: geo.x, width: geo.width }}
              title={`${t.title}: ${bar.start} → ${bar.end}${t.deadline ? `, deadline ${t.deadline}` : ""}. Drag to move.`}
              aria-label={`Bar ${t.title}`}
              {...draggable(barTarget("move"), () => onOpenTask(t.id))}
            >
              {geo.width >= MIN_RESIZE_WIDTH_PX && (
                <>
                  <span
                    className="tl-handle start"
                    title="Drag to change the start date"
                    aria-hidden="true"
                    {...draggable(barTarget("start"), () => onOpenTask(t.id))}
                  />
                  <span
                    className="tl-handle end"
                    title="Drag to change the end date"
                    aria-hidden="true"
                    {...draggable(barTarget("end"), () => onOpenTask(t.id))}
                  />
                </>
              )}
            </button>
          )}
          {barKind && geo && bar && (
            <span className="tl-drag-hint" style={{ left: geo.x + geo.width + 8 }}>
              {shortDate(bar.start, today)} → {shortDate(bar.end, today)}
            </span>
          )}
          {deadline && (
            <button
              className={`tl-deadline${cls}${geo ? "" : " solo"}${draggingClass(deadlineTarget)}`}
              style={{ left: x(deadline) + px / 2 }}
              title={`Deadline ${t.deadline}${badge ? ` (${badge})` : ""}. Drag to change.`}
              aria-label={`Deadline ${t.title}`}
              {...draggable(deadlineTarget, () => onOpenTask(t.id))}
            />
          )}
          {deadline && isDragging(deadlineTarget) && (
            <span className="tl-drag-hint" style={{ left: x(deadline) + px / 2 + 12 }}>
              Due {shortDate(deadline, today)}
            </span>
          )}
        </div>
      </div>
    );
  };

  // Drag on empty chart space scrolls the view (spec slice 8).
  const panHandlers = {
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = scroller.current;
      if (e.button !== 0 || !el || (e.target as HTMLElement).closest("button")) return;
      el.setPointerCapture(e.pointerId);
      pan.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      setPanning(true);
    },
    onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
      const el = scroller.current;
      const p = pan.current;
      if (!el || !p) return;
      el.scrollLeft = p.left - (e.clientX - p.x);
      el.scrollTop = p.top - (e.clientY - p.y);
    },
    onPointerUp: () => {
      pan.current = null;
      setPanning(false);
    },
    onPointerCancel: () => {
      pan.current = null;
      setPanning(false);
    },
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
        <span className="muted">Tasks without dates are not shown. Drag to change dates, click to edit.</span>
      </div>

      {empty ? (
        <p className="muted">Nothing to show yet: give tasks a start/end date or a deadline, or add a milestone.</p>
      ) : (
        <div
          className={`tl-scroller${panning ? " panning" : ""}${drag?.moved ? " drag-active" : ""}`}
          ref={scroller}
          data-range-start={range.start}
          {...panHandlers}
        >
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
                  const target: DragTarget | null = m ? { kind: "milestone", milestoneId: m.id } : null;
                  const date = m && target ? addDays(m.date, deltaFor(target)) : null;
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
                          {m && target && date && (
                            <>
                              <button
                                className={`tl-diamond${statusClass(info!.status)}${m.isReached ? " done" : ""}${draggingClass(target)}`}
                                style={{ left: x(date) + px / 2 }}
                                title={`Milestone ${m.title}: ${m.date}. Drag to change.`}
                                aria-label={`Milestone ${m.title}`}
                                {...draggable(target, () => onOpenMilestone(m.id))}
                              />
                              {isDragging(target) && (
                                <span className="tl-drag-hint" style={{ left: x(date) + px / 2 + 14 }}>
                                  {shortDate(date, today)}
                                </span>
                              )}
                            </>
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

function sameTarget(a: DragTarget, b: DragTarget): boolean {
  if (a.kind === "milestone" || b.kind === "milestone") {
    return a.kind === b.kind && (a as { milestoneId: string }).milestoneId === (b as { milestoneId: string }).milestoneId;
  }
  return a.kind === b.kind && a.taskId === b.taskId;
}
