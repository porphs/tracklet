import { useState } from "react";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { ConfirmDialog } from "./ConfirmDialog";
import { InlineEdit } from "./InlineEdit";
import { usePanelEsc } from "./usePanelEsc";
import { LABEL_COLORS } from "../data/repository";
import type { Label } from "../domain/types";

/** Manage a board's labels: add, rename (double-click), recolour, delete with undo. */
export function LabelsPanel({ boardId, onClose }: { boardId: string; onClose: () => void }) {
  const store = useStore();
  const { attempt, offerUndo } = useNotices();
  const labels = store.repo.listLabels(boardId);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string>(LABEL_COLORS[0]);
  const [deleting, setDeleting] = useState<Label | null>(null);
  usePanelEsc(onClose, !!deleting);

  const countFor = (id: string) =>
    store.sql.get<{ n: number }>("SELECT COUNT(*) AS n FROM task_label WHERE label_id = ?", [id])!.n;

  return (
    <aside className="panel" aria-label="Labels">
      <div className="panel-header">
        <h2>Labels</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="list">
        {labels.length === 0 && <div className="muted">No labels on this board yet.</div>}
        {labels.map((l) => (
          <div key={l.id} className="list-row">
            <span className={`chip chip-${l.color}`}>
              <InlineEdit
                value={l.name}
                label="Label name"
                onSave={(v) => attempt(() => store.mutate((r) => r.updateLabel(l.id, { name: v })))}
              />
            </span>
            <div className="row">
              <ColorSelect
                value={l.color}
                onChange={(c) => attempt(() => store.mutate((r) => r.updateLabel(l.id, { color: c })))}
              />
              <button className="link-button danger" onClick={() => setDeleting(l)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
      <form
        className="list"
        onSubmit={(e) => {
          e.preventDefault();
          if (attempt(() => store.mutate((r) => r.createLabel(boardId, name, color)))) setName("");
        }}
      >
        <h2>Add label</h2>
        <div className="row">
          <input aria-label="New label name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <ColorSelect value={color} onChange={setColor} />
          <button type="submit" disabled={!name.trim()}>
            Add
          </button>
        </div>
      </form>
      <div className="muted">Double-click a label to rename it.</div>
      {deleting && (
        <ConfirmDialog
          title="Delete this label?"
          message={`“${deleting.name}” will be removed from ${countFor(deleting.id)} task(s). The tasks stay.`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const l = deleting;
            setDeleting(null);
            const deleted = store.mutate((r) => r.deleteLabel(l.id));
            offerUndo(`Deleted label “${l.name}”.`, deleted);
          }}
        />
      )}
    </aside>
  );
}

function ColorSelect({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <select aria-label="Label colour" className={`chip chip-${value}`} value={value} onChange={(e) => onChange(e.target.value)}>
      {LABEL_COLORS.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
