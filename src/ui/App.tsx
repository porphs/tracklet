import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./useStore";
import { NoticeContext, type Notices } from "./notice";
import { BoardView } from "./BoardView";
import { TaskPanel } from "./TaskPanel";
import { Sidebar } from "./Sidebar";
import { ConfirmDialog } from "./ConfirmDialog";
import { MilestonePanel, MilestonesPanel } from "./MilestonePanels";
import { LabelsPanel } from "./LabelsPanel";
import { SettingsPanel } from "./SettingsPanel";
import type { PanelState } from "./panels";
import type { Deleted } from "../data/repository";
import type { View } from "../domain/types";
import { countStatuses } from "../domain/deadline";
import { labelNames } from "../domain/filter";
import { CalendarView, type Scope } from "./CalendarView";
import { TimelineView } from "./TimelineView";
import { isTauri } from "../storage/persistence";

const VIEWS: { id: View; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
  { id: "calendar", label: "Calendar" },
];

const UNDO_MS = 10_000;

export function App() {
  const store = useStore();
  const repo = store.repo;
  const boards = repo.listBoards();
  const [boardId, setBoardId] = useState<string | undefined>(() => repo.getSetting("last_board_id"));
  const [view, setView] = useState<View>(() => {
    const v = repo.getSetting("last_view");
    return VIEWS.some((x) => x.id === v) ? (v as View) : "board";
  });
  const [panel, setPanel] = useState<PanelState>(null);
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("board");
  const [notice, setNotice] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ message: string; deleted: Deleted } | null>(null);
  const [confirmDeleteBoard, setConfirmDeleteBoard] = useState(false);
  const undoTimer = useRef<number | undefined>(undefined);
  const noticeTimer = useRef<number | undefined>(undefined);

  const board = boards.find((b) => b.id === boardId) ?? boards[0];

  const notices: Notices = useMemo(() => {
    const notify = (message: string) => {
      setNotice(message);
      window.clearTimeout(noticeTimer.current);
      noticeTimer.current = window.setTimeout(() => setNotice(null), 6000);
    };
    return {
      notify,
      offerUndo(message, deleted) {
        setUndo({ message, deleted });
        window.clearTimeout(undoTimer.current);
        undoTimer.current = window.setTimeout(() => setUndo(null), UNDO_MS);
      },
      attempt(fn) {
        try {
          fn();
          return true;
        } catch (e) {
          notify(e instanceof Error ? e.message : String(e));
          return false;
        }
      },
    };
  }, []);

  const closePanel = useCallback(() => setPanel(null), []);
  const openTask = useCallback((id: string) => setPanel({ kind: "task", id }), []);

  // The menu bar popover asks to open a task here (src-tauri/src/lib.rs `open_task`).
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let gone = false;
    import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("open-task", ({ payload: id }) => {
        const task = repo.getTask(id);
        if (!task) return;
        setBoardId(task.boardId);
        store.mutate((r) => r.setSetting("last_board_id", task.boardId));
        setLabelFilter(null);
        setPanel({ kind: "task", id });
      }).then((fn) => (gone ? fn() : (unlisten = fn))),
    );
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [repo, store]);

  // "Today" is re-checked every minute and when the window regains focus, so statuses
  // update when the date rolls over without a restart (spec §2).
  useEffect(() => {
    let last = store.today();
    const check = () => {
      const now = store.today();
      if (now !== last) {
        last = now;
        store.refresh();
      }
    };
    const timer = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [store]);

  const selectBoard = (id: string) => {
    setBoardId(id);
    setPanel(null);
    setLabelFilter(null); // the filter clears when switching boards
    store.mutate((r) => r.setSetting("last_board_id", id));
  };

  const selectView = (v: View) => {
    setView(v);
    store.mutate((r) => r.setSetting("last_view", v));
  };

  // A panel whose subject was deleted closes by itself.
  useEffect(() => {
    if (panel?.kind === "task" && !repo.getTask(panel.id)) setPanel(null);
    if (panel?.kind === "milestone" && !repo.getMilestone(panel.id)) setPanel({ kind: "milestones" });
  });

  const counts = board
    ? countStatuses(
        (() => {
          const done = repo.doneColumnIds();
          return repo.listTasks(board.id).map((task) => ({ task, done: done.has(task.columnId) }));
        })(),
        repo.listMilestones(board.id),
        store.today(),
        repo.nearWindow(),
      )
    : { overdue: 0, near: 0 };
  // In the All-boards scope the filter offers every board's label names (matched by name).
  const filterNames = board
    ? labelNames(view !== "board" && scope === "all" ? repo.listAllLabels() : repo.listLabels(board.id))
    : [];

  return (
    <NoticeContext.Provider value={notices}>
      <div className="app">
        <Sidebar
          activeBoardId={board?.id}
          onSelect={selectBoard}
          onOpenSettings={() => setPanel({ kind: "settings" })}
          onImported={() => {
            setPanel(null);
            setLabelFilter(null);
            setBoardId(repo.getSetting("last_board_id"));
          }}
        />

        <main className="main">
          {store.lastSaveError && (
            <div className="save-error" role="alert">
              Could not save: {store.lastSaveError}
            </div>
          )}
          {board ? (
            <>
              <header className="header">
                <h1>{board.name}</h1>
                <div className="tabs" role="tablist">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      role="tab"
                      aria-selected={view === v.id}
                      className={`tab${view === v.id ? " active" : ""}`}
                      onClick={() => selectView(v.id)}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <span className="counts" aria-label="Deadline counts">
                  <span className={counts.overdue ? "status-overdue" : ""}>{counts.overdue} overdue</span>
                  {" · "}
                  <span className={counts.near ? "status-near" : ""}>{counts.near} due soon</span>
                </span>
                <div className="header-actions">
                  {view !== "board" && (
                    <div className="scope" role="radiogroup" aria-label="Scope">
                      {(["board", "all"] as const).map((s) => (
                        <button
                          key={s}
                          role="radio"
                          aria-checked={scope === s}
                          className={`tab${scope === s ? " active" : ""}`}
                          onClick={() => setScope(s)}
                        >
                          {s === "board" ? "This board" : "All boards"}
                        </button>
                      ))}
                    </div>
                  )}
                  <label className="row">
                    <span className="muted">Label</span>
                    <select
                      aria-label="Filter by label"
                      value={labelFilter ?? ""}
                      onChange={(e) => setLabelFilter(e.target.value || null)}
                    >
                      <option value="">All tasks</option>
                      {filterNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button onClick={() => setPanel({ kind: "milestones" })}>Milestones</button>
                  <button onClick={() => setPanel({ kind: "labels" })}>Labels</button>
                  <button className="link-button danger" onClick={() => setConfirmDeleteBoard(true)}>
                    Delete board
                  </button>
                </div>
              </header>
              <div className="content">
                {view === "board" && (
                  <BoardView
                    boardId={board.id}
                    selectedTaskId={panel?.kind === "task" ? panel.id : null}
                    onSelectTask={openTask}
                    labelFilter={labelFilter}
                  />
                )}
                {view === "timeline" && (
                  <TimelineView
                    boardId={board.id}
                    scope={scope}
                    labelFilter={labelFilter}
                    onOpenTask={openTask}
                    onOpenMilestone={(id) => setPanel({ kind: "milestone", id })}
                  />
                )}
                {view === "calendar" && (
                  <CalendarView
                    boardId={board.id}
                    scope={scope}
                    labelFilter={labelFilter}
                    onOpenTask={openTask}
                    onOpenMilestone={(id) => setPanel({ kind: "milestone", id })}
                  />
                )}
              </div>
            </>
          ) : (
            <div className="content">
              <p>No boards yet. Use “+ New board” in the sidebar.</p>
            </div>
          )}

          {notice && (
            <div className="notice" role="status">
              {notice}
              <button className="link-button" onClick={() => setNotice(null)}>
                Dismiss
              </button>
            </div>
          )}
          {undo && (
            <div className="undo-bar" role="status">
              {undo.message}
              <button
                onClick={() => {
                  const d = undo.deleted;
                  setUndo(null);
                  notices.attempt(() => store.mutate((r) => r.restore(d)));
                }}
              >
                Undo
              </button>
            </div>
          )}
        </main>

        {panel?.kind === "task" && (
          <TaskPanel
            taskId={panel.id}
            onClose={closePanel}
            onDeleted={(title, deleted) => {
              closePanel();
              notices.offerUndo(`Deleted “${title}”.`, deleted);
            }}
          />
        )}
        {panel?.kind === "milestones" && board && (
          <MilestonesPanel
            boardId={board.id}
            onOpen={(id) => setPanel({ kind: "milestone", id })}
            onClose={closePanel}
          />
        )}
        {panel?.kind === "milestone" && (
          <MilestonePanel milestoneId={panel.id} onBack={() => setPanel({ kind: "milestones" })} onClose={closePanel} />
        )}
        {panel?.kind === "labels" && board && <LabelsPanel boardId={board.id} onClose={closePanel} />}
        {panel?.kind === "settings" && <SettingsPanel onClose={closePanel} />}

        {confirmDeleteBoard && board && (
          <ConfirmDialog
            title="Delete this board?"
            message={`“${board.name}” and all of its columns, tasks, milestones and labels will be permanently deleted. This cannot be undone in the app.`}
            confirmLabel="Delete board"
            requireTyping={board.name}
            onCancel={() => setConfirmDeleteBoard(false)}
            onConfirm={() => {
              setConfirmDeleteBoard(false);
              setPanel(null);
              notices.attempt(() => store.mutate((r) => r.deleteBoard(board.id)));
            }}
          />
        )}
      </div>
    </NoticeContext.Provider>
  );
}
