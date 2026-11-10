import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "./useStore";
import { NoticeContext, type Notices } from "./notice";
import { BoardView } from "./BoardView";
import { TaskPanel } from "./TaskPanel";
import { Sidebar } from "./Sidebar";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Deleted } from "../data/repository";
import type { View } from "../domain/types";

const VIEWS: { id: View; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "timeline", label: "Timeline" },
  { id: "calendar", label: "Calendar" },
];

const UNDO_MS = 10_000;

export function App() {
  const store = useStore();
  const boards = store.repo.listBoards();
  const [boardId, setBoardId] = useState<string | undefined>(() => store.repo.getSetting("last_board_id"));
  const [view, setView] = useState<View>(() => {
    const v = store.repo.getSetting("last_view");
    return VIEWS.some((x) => x.id === v) ? (v as View) : "board";
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
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

  const closePanel = useCallback(() => setSelectedTaskId(null), []);

  const selectBoard = (id: string) => {
    setBoardId(id);
    setSelectedTaskId(null);
    store.mutate((r) => r.setSetting("last_board_id", id));
  };

  const selectView = (v: View) => {
    setView(v);
    store.mutate((r) => r.setSetting("last_view", v));
  };

  // A deleted task's panel closes by itself.
  useEffect(() => {
    if (selectedTaskId && !store.repo.getTask(selectedTaskId)) setSelectedTaskId(null);
  });

  return (
    <NoticeContext.Provider value={notices}>
      <div className="app">
        <Sidebar activeBoardId={board?.id} onSelect={selectBoard} />

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
                <div className="header-spacer" />
                <button className="link-button danger" onClick={() => setConfirmDeleteBoard(true)}>
                  Delete board
                </button>
              </header>
              <div className="content">
                {view === "board" && (
                  <BoardView boardId={board.id} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />
                )}
                {view === "timeline" && <p className="muted">Timeline view arrives in slice 5.</p>}
                {view === "calendar" && <p className="muted">Calendar view arrives in slice 4.</p>}
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

        {selectedTaskId && (
          <TaskPanel
            taskId={selectedTaskId}
            onClose={closePanel}
            onDeleted={(title, deleted) => {
              closePanel();
              notices.offerUndo(`Deleted “${title}”.`, deleted);
            }}
          />
        )}

        {confirmDeleteBoard && board && (
          <ConfirmDialog
            title="Delete this board?"
            message={`“${board.name}” and all of its columns, tasks, milestones and labels will be permanently deleted. This cannot be undone in the app.`}
            confirmLabel="Delete board"
            requireTyping={board.name}
            onCancel={() => setConfirmDeleteBoard(false)}
            onConfirm={() => {
              setConfirmDeleteBoard(false);
              setSelectedTaskId(null);
              notices.attempt(() => store.mutate((r) => r.deleteBoard(board.id)));
            }}
          />
        )}
      </div>
    </NoticeContext.Provider>
  );
}
