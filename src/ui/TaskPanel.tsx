import { useEffect, useState } from "react";
import { useStore } from "./useStore";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Task } from "../domain/types";
import type { Deleted } from "../data/repository";

interface Props {
  taskId: string;
  onClose: () => void;
  onDeleted: (title: string, deleted: Deleted) => void;
}

/** The shared details editor. Every edit saves immediately; there is no Save button. */
export function TaskPanel({ taskId, onClose, onDeleted }: Props) {
  const store = useStore();
  const task = store.repo.getTask(taskId);
  if (!task) return null;
  return <TaskPanelInner key={task.id} task={task} onClose={onClose} onDeleted={onDeleted} />;
}

function TaskPanelInner({ task, onClose, onDeleted }: { task: Task } & Omit<Props, "taskId">) {
  const store = useStore();
  const columns = store.repo.listColumns(task.boardId);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Esc closes the panel (unless a dialog is open; it handles Esc itself).
  useEffect(() => {
    if (confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, confirming]);

  const save = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside className="panel" aria-label="Task details">
      <div className="panel-header">
        <h2>Task</h2>
        <button onClick={onClose} title="Close (Esc)">Close</button>
      </div>

      <label className="field">
        <span>Title</span>
        <input
          value={title}
          autoFocus
          onChange={(e) => {
            setTitle(e.target.value);
            save(() => store.mutate((r) => r.updateTask(task.id, { title: e.target.value })));
          }}
        />
      </label>

      <label className="field">
        <span>Column</span>
        <select
          value={task.columnId}
          onChange={(e) => save(() => store.mutate((r) => r.moveTask(task.id, e.target.value, Number.MAX_SAFE_INTEGER)))}
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            save(() => store.mutate((r) => r.updateTask(task.id, { description: e.target.value })));
          }}
        />
      </label>

      {error && <div className="error" role="alert">{error}</div>}

      <div>
        <button className="danger" onClick={() => setConfirming(true)}>
          Delete task
        </button>
      </div>
      <div className="muted">Changes are saved automatically.</div>

      {confirming && (
        <ConfirmDialog
          title="Delete this task?"
          message={`“${task.title}” will be deleted.`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            const deleted = store.mutate((r) => r.deleteTask(task.id));
            setConfirming(false);
            onDeleted(task.title, deleted);
          }}
        />
      )}
    </aside>
  );
}
