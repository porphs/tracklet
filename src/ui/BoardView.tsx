import { useState } from "react";
import { useStore } from "./useStore";
import type { Column } from "../domain/types";

interface Props {
  boardId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}

export function BoardView({ boardId, selectedTaskId, onSelectTask }: Props) {
  const store = useStore();
  const columns = store.repo.listColumns(boardId);
  return (
    <div className="columns">
      {columns.map((col) => (
        <ColumnView key={col.id} column={col} selectedTaskId={selectedTaskId} onSelectTask={onSelectTask} />
      ))}
    </div>
  );
}

function ColumnView({ column, selectedTaskId, onSelectTask }: { column: Column } & Omit<Props, "boardId">) {
  const store = useStore();
  const tasks = store.repo.listTasksInColumn(column.id);
  return (
    <section className="column" aria-label={`Column ${column.name}`}>
      <div className="column-header">
        <h2>{column.name}</h2>
        <span className="muted">{tasks.length}</span>
      </div>
      {tasks.map((t) => (
        <button
          key={t.id}
          className={`card${t.id === selectedTaskId ? " selected" : ""}${column.isDoneColumn ? " done" : ""}`}
          onClick={() => onSelectTask(t.id)}
        >
          {t.title}
        </button>
      ))}
      <AddTask column={column} />
    </section>
  );
}

/** "+ Add task": Enter creates the task and keeps the input open for the next one. */
function AddTask({ column }: { column: Column }) {
  const store = useStore();
  const [title, setTitle] = useState("");
  return (
    <form
      className="add-task"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        store.mutate((r) => r.createTask({ boardId: column.boardId, columnId: column.id, title }));
        setTitle("");
      }}
    >
      <input
        placeholder="+ Add task"
        aria-label={`Add task to ${column.name}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
    </form>
  );
}
