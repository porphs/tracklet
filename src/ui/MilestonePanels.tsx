import { useState } from "react";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { ConfirmDialog } from "./ConfirmDialog";
import { DeadlineBadge } from "./status";
import { usePanelEsc } from "./usePanelEsc";
import type { Milestone } from "../domain/types";

/** The board's milestones: list, add, open one. */
export function MilestonesPanel({
  boardId,
  onOpen,
  onClose,
}: {
  boardId: string;
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const store = useStore();
  const { attempt } = useNotices();
  const milestones = store.repo.listMilestones(boardId);
  const today = store.today();
  const nearWindow = store.repo.nearWindow();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  usePanelEsc(onClose);

  return (
    <aside className="panel" aria-label="Milestones">
      <div className="panel-header">
        <h2>Milestones</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <div className="list">
        {milestones.length === 0 && <div className="muted">No milestones on this board yet.</div>}
        {milestones.map((m) => (
          <div key={m.id} className="list-row">
            <button className={`link-button${m.isReached ? " reached" : ""}`} onClick={() => onOpen(m.id)}>
              ◆ {m.title}
            </button>
            <DeadlineBadge date={m.date} today={today} nearWindow={nearWindow} closed={m.isReached} prefix="On" />
          </div>
        ))}
      </div>
      <form
        className="list"
        onSubmit={(e) => {
          e.preventDefault();
          if (attempt(() => store.mutate((r) => r.createMilestone(boardId, title, date)))) {
            setTitle("");
            setDate("");
          }
        }}
      >
        <h2>Add milestone</h2>
        <label className="field">
          <span>Title</span>
          <input aria-label="Milestone title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span>Date</span>
          <input aria-label="Milestone date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <div>
          <button type="submit" disabled={!title.trim() || !date}>
            Add milestone
          </button>
        </div>
      </form>
    </aside>
  );
}

/** Editor for one milestone. Auto-saves like the task panel. */
export function MilestonePanel({
  milestoneId,
  onBack,
  onClose,
}: {
  milestoneId: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const store = useStore();
  const m = store.repo.getMilestone(milestoneId);
  if (!m) return null;
  return <MilestoneEditor key={m.id} m={m} onBack={onBack} onClose={onClose} />;
}

function MilestoneEditor({ m, onBack, onClose }: { m: Milestone; onBack: () => void; onClose: () => void }) {
  const store = useStore();
  const { offerUndo } = useNotices();
  const [title, setTitle] = useState(m.title);
  const [description, setDescription] = useState(m.description);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const linked = store.repo.listTasks(m.boardId).filter((t) => t.milestoneId === m.id);
  usePanelEsc(onClose, confirming);

  const save = (fn: () => void) => {
    try {
      fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <aside className="panel" aria-label="Milestone details">
      <div className="panel-header">
        <h2>◆ Milestone</h2>
        <div className="row">
          <button onClick={onBack}>All milestones</button>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
      <label className="field">
        <span>Title</span>
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            save(() => store.mutate((r) => r.updateMilestone(m.id, { title: e.target.value })));
          }}
        />
      </label>
      <label className="field">
        <span>Date</span>
        <input
          type="date"
          aria-label="Date"
          value={m.date}
          onChange={(e) => save(() => store.mutate((r) => r.updateMilestone(m.id, { date: e.target.value })))}
        />
      </label>
      <DeadlineBadge
        date={m.date}
        today={store.today()}
        nearWindow={store.repo.nearWindow()}
        closed={m.isReached}
        prefix="On"
      />
      <label className="row">
        <input
          type="checkbox"
          checked={m.isReached}
          onChange={(e) => save(() => store.mutate((r) => r.updateMilestone(m.id, { isReached: e.target.checked })))}
        />
        Reached
      </label>
      <label className="field">
        <span>Description</span>
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            save(() => store.mutate((r) => r.updateMilestone(m.id, { description: e.target.value })));
          }}
        />
      </label>
      <div className="field">
        <span>Linked tasks ({linked.length})</span>
        {linked.map((t) => (
          <div key={t.id}>{t.title}</div>
        ))}
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <div>
        <button className="danger" onClick={() => setConfirming(true)}>
          Delete milestone
        </button>
      </div>
      {confirming && (
        <ConfirmDialog
          title="Delete this milestone?"
          message={`“${m.title}” will be deleted. Its ${linked.length} linked task(s) stay, without a milestone.`}
          confirmLabel="Delete"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            const deleted = store.mutate((r) => r.deleteMilestone(m.id));
            offerUndo(`Deleted milestone “${m.title}”.`, deleted);
            onBack();
          }}
        />
      )}
    </aside>
  );
}
