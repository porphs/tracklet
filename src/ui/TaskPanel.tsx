import { useState } from "react";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeadlineBadge } from "./status";
import { usePanelEsc } from "./usePanelEsc";
import { WARNING_TEXT, taskWarnings } from "../domain/deadline";
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
  const { notify } = useNotices();
  const repo = store.repo;
  const columns = repo.listColumns(task.boardId);
  const milestones = repo.listMilestones(task.boardId);
  const labels = repo.listLabels(task.boardId);
  const labelIds = new Set(repo.taskLabelIds(task.id));
  const board = repo.getBoard(task.boardId);
  const done = !!repo.getColumn(task.columnId)?.isDoneColumn;
  const milestone = task.milestoneId ? repo.getMilestone(task.milestoneId) : undefined;
  const today = store.today();
  const nearWindow = repo.nearWindow();

  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  usePanelEsc(onClose, confirming);

  const save = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const dateField = (label: string, key: "startDate" | "endDate" | "deadline") => (
    <label className="field">
      <span>{label}</span>
      <div className="row">
        <input
          type="date"
          aria-label={label}
          value={task[key] ?? ""}
          onChange={(e) => save(() => store.mutate((r) => r.updateTask(task.id, { [key]: e.target.value || null })))}
        />
        {task[key] && (
          <button
            className="link-button"
            onClick={(e) => {
              e.preventDefault();
              save(() => store.mutate((r) => r.updateTask(task.id, { [key]: null })));
            }}
          >
            Clear
          </button>
        )}
      </div>
    </label>
  );

  const warnings = taskWarnings(task, milestone, done);

  return (
    <aside className="panel" aria-label="Task details">
      <div className="panel-header">
        <h2>Task</h2>
        <button onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>
      <div className="muted">Board: {board?.name}</div>

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
              {c.isDoneColumn ? " (done)" : ""}
            </option>
          ))}
        </select>
      </label>

      {dateField("Deadline", "deadline")}
      <div className="row">
        <DeadlineBadge date={task.deadline} today={today} nearWindow={nearWindow} closed={done} />
        {done && <span className="muted">Done</span>}
      </div>
      {dateField("Start date", "startDate")}
      {dateField("End date", "endDate")}

      <label className="field">
        <span>Milestone</span>
        <select
          value={task.milestoneId ?? ""}
          onChange={(e) => save(() => store.mutate((r) => r.updateTask(task.id, { milestoneId: e.target.value || null })))}
        >
          <option value="">No milestone</option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              ◆ {m.title} ({m.date})
            </option>
          ))}
        </select>
      </label>

      {warnings.length > 0 && (
        <div className="list">
          {warnings.map((w) => (
            <div key={w} className="warning">
              ⚠ {WARNING_TEXT[w]}
            </div>
          ))}
        </div>
      )}

      <div className="field">
        <span>Labels</span>
        {labels.length === 0 && <div className="muted">No labels on this board yet (use “Labels” in the header).</div>}
        <div className="row">
          {labels.map((l) => (
            <label key={l.id} className="row">
              <input
                type="checkbox"
                checked={labelIds.has(l.id)}
                onChange={(e) => save(() => store.mutate((r) => r.setTaskLabel(task.id, l.id, e.target.checked)))}
              />
              <span className={`chip chip-${l.color}`}>{l.name}</span>
            </label>
          ))}
        </div>
      </div>

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

      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}

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
            setConfirming(false);
            try {
              const deleted = store.mutate((r) => r.deleteTask(task.id));
              onDeleted(task.title, deleted);
            } catch (e) {
              notify(String(e));
            }
          }}
        />
      )}
    </aside>
  );
}
