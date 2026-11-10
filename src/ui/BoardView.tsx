import { useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { InlineEdit } from "./InlineEdit";
import { ConfirmDialog } from "./ConfirmDialog";
import type { Column, Task } from "../domain/types";

interface Props {
  boardId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
}

// Drag ids are prefixed so columns and cards can share one DndContext.
const colKey = (id: string) => `col:${id}`;
const taskKey = (id: string) => `task:${id}`;
const bodyKey = (id: string) => `body:${id}`;
const strip = (key: string) => key.slice(key.indexOf(":") + 1);
const kind = (key: string) => key.slice(0, key.indexOf(":"));

/** Column ids → ordered task ids, used as the live layout while a card is dragged. */
type Layout = Record<string, string[]>;

export function BoardView({ boardId, selectedTaskId, onSelectTask }: Props) {
  const store = useStore();
  const { attempt } = useNotices();
  const columns = store.repo.listColumns(boardId);
  const tasksById = new Map(store.repo.listTasks(boardId).map((t) => [t.id, t]));
  const stored: Layout = Object.fromEntries(
    columns.map((c) => [c.id, store.repo.listTasksInColumn(c.id).map((t) => t.id)]),
  );

  const [dragLayout, setDragLayout] = useState<Layout | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const layout = dragLayout ?? stored;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const containerOf = (key: string, l: Layout): string | undefined => {
    if (kind(key) === "body" || kind(key) === "col") return strip(key);
    const id = strip(key);
    return Object.keys(l).find((c) => l[c].includes(id));
  };

  // Columns only collide with columns; cards collide with cards and column bodies.
  const collision: CollisionDetection = (args) => {
    const isCol = kind(String(args.active.id)) === "col";
    const droppableContainers = args.droppableContainers.filter((c) =>
      isCol ? kind(String(c.id)) === "col" : kind(String(c.id)) !== "col",
    );
    return (isCol ? closestCenter : closestCorners)({ ...args, droppableContainers });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    setActiveKey(String(active.id));
    if (kind(String(active.id)) === "task") setDragLayout(stored);
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragLayout || kind(String(active.id)) !== "task") return;
    const from = containerOf(String(active.id), dragLayout);
    const to = containerOf(String(over.id), dragLayout);
    if (!from || !to || from === to) return;
    const id = strip(String(active.id));
    const target = dragLayout[to].filter((x) => x !== id);
    const overIndex = kind(String(over.id)) === "task" ? target.indexOf(strip(String(over.id))) : -1;
    target.splice(overIndex >= 0 ? overIndex : target.length, 0, id);
    setDragLayout({ ...dragLayout, [from]: dragLayout[from].filter((x) => x !== id), [to]: target });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const a = String(active.id);
    const l = dragLayout;
    setActiveKey(null);
    setDragLayout(null);
    if (!over) return;
    const o = String(over.id);

    if (kind(a) === "col") {
      if (a !== o) {
        const to = columns.findIndex((c) => colKey(c.id) === o);
        attempt(() => store.mutate((r) => r.moveColumn(strip(a), to)));
      }
      return;
    }
    if (!l) return;
    const col = containerOf(a, l);
    if (!col) return;
    let ids = l[col];
    const id = strip(a);
    if (kind(o) === "task" && containerOf(o, l) === col) {
      ids = arrayMove(ids, ids.indexOf(id), ids.indexOf(strip(o)));
    }
    const index = ids.indexOf(id);
    const t = tasksById.get(id);
    if (t && (t.columnId !== col || t.position !== index)) {
      attempt(() => store.mutate((r) => r.moveTask(id, col, index)));
    }
  };

  const activeTask = activeKey && kind(activeKey) === "task" ? tasksById.get(strip(activeKey)) : undefined;
  const activeColumn = activeKey && kind(activeKey) === "col" ? columns.find((c) => colKey(c.id) === activeKey) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collision}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveKey(null);
        setDragLayout(null);
      }}
    >
      <div className="columns">
        <SortableContext items={columns.map((c) => colKey(c.id))} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <ColumnView
              key={col.id}
              column={col}
              tasks={(layout[col.id] ?? []).map((id) => tasksById.get(id)!).filter(Boolean)}
              selectedTaskId={selectedTaskId}
              onSelectTask={onSelectTask}
            />
          ))}
        </SortableContext>
        <AddColumn boardId={boardId} />
      </div>
      <DragOverlay>
        {activeTask && <CardFace task={activeTask} done={false} />}
        {activeColumn && <div className="column column-ghost">{activeColumn.name}</div>}
      </DragOverlay>
    </DndContext>
  );
}

function ColumnView({
  column,
  tasks,
  selectedTaskId,
  onSelectTask,
}: { column: Column; tasks: Task[] } & Omit<Props, "boardId">) {
  const store = useStore();
  const { attempt } = useNotices();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const sortable = useSortable({ id: colKey(column.id) });
  const body = useDroppable({ id: bodyKey(column.id) });

  return (
    <section
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={`column${sortable.isDragging ? " dragging" : ""}`}
      aria-label={`Column ${column.name}`}
    >
      <div className="column-header" {...sortable.attributes} {...sortable.listeners}>
        <h2>
          <InlineEdit
            value={column.name}
            label="Column name"
            onSave={(name) => attempt(() => store.mutate((r) => r.renameColumn(column.id, name)))}
          />
        </h2>
        <span className="muted">{tasks.length}</span>
      </div>
      <div className="column-tools">
        <label title="Tasks in a done column count as done">
          <input
            type="checkbox"
            checked={column.isDoneColumn}
            onChange={(e) => attempt(() => store.mutate((r) => r.setDoneColumn(column.id, e.target.checked)))}
          />{" "}
          Done column
        </label>
        <button
          className="link-button danger"
          onClick={() => {
            if (tasks.length) {
              attempt(() => store.mutate((r) => r.deleteColumn(column.id)));
            } else {
              setConfirmDelete(true);
            }
          }}
        >
          Delete
        </button>
      </div>
      <div ref={body.setNodeRef} className="column-body">
        <SortableContext items={tasks.map((t) => taskKey(t.id))} strategy={verticalListSortingStrategy}>
          {tasks.map((t) => (
            <SortableCard
              key={t.id}
              task={t}
              done={column.isDoneColumn}
              selected={t.id === selectedTaskId}
              onSelect={onSelectTask}
            />
          ))}
        </SortableContext>
      </div>
      <AddTask column={column} />
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this column?"
          message={`The empty column “${column.name}” will be deleted.`}
          confirmLabel="Delete column"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false);
            attempt(() => store.mutate((r) => r.deleteColumn(column.id)));
          }}
        />
      )}
    </section>
  );
}

function SortableCard({
  task,
  done,
  selected,
  onSelect,
}: {
  task: Task;
  done: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: taskKey(task.id),
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={isDragging ? "card-placeholder" : undefined}
      {...attributes}
      {...listeners}
      role="button"
      aria-label={task.title}
      onClick={() => onSelect(task.id)}
    >
      <CardFace task={task} done={done} selected={selected} />
    </div>
  );
}

/** What a card shows. Labels, deadline badge and milestone tag arrive in slice 3. */
export function CardFace({ task, done, selected = false }: { task: Task; done: boolean; selected?: boolean }) {
  return (
    <div className={`card${selected ? " selected" : ""}${done ? " done" : ""}`} data-task-id={task.id}>
      <div className="card-title">{task.title}</div>
    </div>
  );
}

/** "+ Add task": Enter creates the task and keeps the input open for the next one. */
function AddTask({ column }: { column: Column }) {
  const store = useStore();
  const { attempt } = useNotices();
  const [title, setTitle] = useState("");
  return (
    <form
      className="add-task"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        if (attempt(() => store.mutate((r) => r.createTask({ boardId: column.boardId, columnId: column.id, title })))) {
          setTitle("");
        }
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

function AddColumn({ boardId }: { boardId: string }) {
  const store = useStore();
  const { attempt } = useNotices();
  const [name, setName] = useState("");
  return (
    <form
      className="add-column"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        if (attempt(() => store.mutate((r) => r.addColumn(boardId, name)))) setName("");
      }}
    >
      <input placeholder="+ Add column" aria-label="Add column" value={name} onChange={(e) => setName(e.target.value)} />
    </form>
  );
}
