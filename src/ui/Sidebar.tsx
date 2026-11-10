import { useState } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { InlineEdit } from "./InlineEdit";
import type { Board } from "../domain/types";
import { BackupControls } from "./BackupControls";

interface Props {
  activeBoardId: string | undefined;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  onImported: () => void;
}

export function Sidebar({ activeBoardId, onSelect, onOpenSettings, onImported }: Props) {
  const store = useStore();
  const { attempt } = useNotices();
  const boards = store.repo.listBoards();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const to = boards.findIndex((b) => b.id === over.id);
    attempt(() => store.mutate((r) => r.moveBoard(String(active.id), to)));
  };

  return (
    <nav className="sidebar" aria-label="Boards">
      <div className="brand">
        <svg className="brand-logo" width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
          <rect className="logo-bg" width="30" height="30" rx="9" />
          <rect className="logo-mark" x="7" y="8" width="10" height="4" rx="2" />
          <rect className="logo-mark" x="19" y="8" width="4" height="4" rx="2" opacity="0.45" />
          <rect className="logo-mark" x="13" y="8" width="4" height="15" rx="2" />
        </svg>
        <span className="brand-name">tracklet</span>
      </div>
      <div className="sidebar-section">
        <div className="sidebar-heading">Boards</div>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={boards.map((b) => b.id)} strategy={verticalListSortingStrategy}>
            {boards.map((b) => (
              <BoardLink key={b.id} board={b} active={b.id === activeBoardId} onSelect={onSelect} />
            ))}
          </SortableContext>
        </DndContext>
        {adding ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              let created: Board | undefined;
              if (attempt(() => (created = store.mutate((r) => r.createBoard(newName))))) {
                setNewName("");
                setAdding(false);
                onSelect(created!.id);
              }
            }}
          >
            <input
              aria-label="New board name"
              placeholder="Board name"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={() => !newName.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === "Escape" && setAdding(false)}
            />
          </form>
        ) : (
          <button className="link-button" onClick={() => setAdding(true)}>
            + New board
          </button>
        )}
      </div>
      <div className="sidebar-footer">
        <BackupControls onImported={onImported} />
        <button className="link-button" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </nav>
  );
}

function BoardLink({ board, active, onSelect }: { board: Board; active: boolean; onSelect: (id: string) => void }) {
  const store = useStore();
  const { attempt } = useNotices();
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: board.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`board-link${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={board.name}
      onClick={() => onSelect(board.id)}
      {...attributes}
      {...listeners}
    >
      <InlineEdit
        value={board.name}
        label="Board name"
        onSave={(name) => attempt(() => store.mutate((r) => r.renameBoard(board.id, name)))}
      />
    </div>
  );
}
