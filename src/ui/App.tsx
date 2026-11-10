import { useCallback, useState } from "react";
import { useStore } from "./useStore";
import { BoardView } from "./BoardView";
import { TaskPanel } from "./TaskPanel";

export function App() {
  const store = useStore();
  const boards = store.repo.listBoards();
  const [boardId, setBoardId] = useState<string>(() => {
    const last = store.repo.getSetting("last_board_id");
    return boards.find((b) => b.id === last)?.id ?? boards[0]?.id;
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const board = boards.find((b) => b.id === boardId) ?? boards[0];

  const closePanel = useCallback(() => setSelectedTaskId(null), []);

  const selectBoard = (id: string) => {
    setBoardId(id);
    setSelectedTaskId(null);
    store.mutate((r) => r.setSetting("last_board_id", id));
  };

  return (
    <div className="app">
      <nav className="sidebar" aria-label="Boards">
        <div className="sidebar-section">
          <div className="sidebar-heading">Boards</div>
          {boards.map((b) => (
            <button
              key={b.id}
              className={`board-link${b.id === board?.id ? " active" : ""}`}
              onClick={() => selectBoard(b.id)}
            >
              {b.name}
            </button>
          ))}
        </div>
      </nav>

      <main className="main">
        {store.lastSaveError && (
          <div className="save-error" role="alert">
            Could not save: {store.lastSaveError}
          </div>
        )}
        <header className="header">
          <h1>{board?.name}</h1>
        </header>
        <div className="content">
          {board && <BoardView boardId={board.id} selectedTaskId={selectedTaskId} onSelectTask={setSelectedTaskId} />}
        </div>
      </main>

      {selectedTaskId && (
        <TaskPanel taskId={selectedTaskId} onClose={closePanel} onDeleted={closePanel} />
      )}
    </div>
  );
}
