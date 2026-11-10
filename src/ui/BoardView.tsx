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
import { DeadlineBadge, statusClass } from "./status";
import { WARNING_TEXT, deadlineStatus, taskWarnings } from "../domain/deadline";
import { matchesLabelFilter } from "../domain/filter";
import type { Column, DateStr, Label, Milestone, Task } from "../domain/types";

interface Props {
  boardId: string;
  selectedTaskId: string | null;
  onSelectTask: (id: string) => void;
  /** Label name to filter by, or null for all tasks. */
  labelFilter: string | null;
}

/** Everything a card needs besides its task, computed once per render of the board. */
interface CardContext {
  today: DateStr;
  nearWindow: number;
  labels: Map<string, Label[]>;
  milestones: Map<string, Milestone>;
}

// Drag ids are prefixed so columns and cards can share one DndContext.
const colKey = (id: string) => `col:${id}`;
const taskKey = (id: string) => `task:${id}`;
const bodyKey = (id: string) => `body:${id}`;
const strip = (key: string) => key.slice(key.indexOf(":") + 1);
const kind = (key: string) => key.slice(0, key.indexOf(":"));

/** Column ids → ordered task ids, used as the live layout while a card is dragged. */
type Layout = Record<string, string[]>;

export function BoardView({ boardId, selectedTaskId, onSelectTask, labelFilter }: Props) {
  const store = useStore();
  const { attempt } = useNotices();
  const columns = store.repo.listColumns(boardId);
  const allTasks = store.repo.listTasks(boardId);
  const tasksById = new Map(allTasks.map((t) => [t.id, t]));
  const ctx: CardContext = {
    today: store.today(),
    nearWindow: store.repo.nearWindow(),
    labels: store.repo.labelsByTask(boardId),
    milestones: new Map(store.repo.listMilestones(boardId).map((m) => [m.id, m])),
  };
  const visible = (id: string) => matchesLabelFilter(ctx.labels.get(id), labelFilter);
  const fullLayout: Layout = Object.fromEntries(columns.map((c) => [c.id, [] as string[]]));
  for (const t of allTasks) fullLayout[t.columnId]?.push(t.id);
  // The board shows (and drags) only tasks that pass the label filter.
  const stored: Layout = Object.fromEntries(columns.map((c) => [c.id, fullLayout[c.id].filter(visible)]));

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
    // Map the drop position among visible cards to an index among all cards in that column,
    // so hidden (filtered-out) cards keep their places.
    const pos = ids.indexOf(id);
    const full = fullLayout[col].filter((x) => x !== id);
    const prev = ids[pos - 1];
    const next = ids[pos + 1];
    const index = prev ? full.indexOf(prev) + 1 : next ? full.indexOf(next) : full.length;
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
              ctx={ctx}
            />
          ))}
        </SortableContext>
        <AddColumn boardId={boardId} />
      </div>
      <DragOverlay>
        {activeTask && <CardFace task={activeTask} done={false} ctx={ctx} />}
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
  ctx,
}: { column: Column; tasks: Task[]; ctx: CardContext } & Omit<Props, "boardId" | "labelFilter">) {
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
      <div className="column-header" {...sortable.attributes} {...sortable.listeners} aria-label={`Drag column ${column.name}`}>
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
            aria-label={`${column.name} is a done column`}
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
              ctx={ctx}
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
  ctx,
}: {
  task: Task;
  done: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  ctx: CardContext;
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
      <CardFace task={task} done={done} selected={selected} ctx={ctx} />
    </div>
  );
}

/** What a card shows: title, label chips, deadline badge, milestone tag and warnings. */
export function CardFace({
  task,
  done,
  selected = false,
  ctx,
}: {
  task: Task;
  done: boolean;
  selected?: boolean;
  ctx: CardContext;
}) {
  const status = deadlineStatus(task.deadline, ctx.today, ctx.nearWindow, done).status;
  const milestone = task.milestoneId ? ctx.milestones.get(task.milestoneId) : undefined;
  const labels = ctx.labels.get(task.id) ?? [];
  const warnings = taskWarnings(task, milestone, done);
  return (
    <div
      className={`card${selected ? " selected" : ""}${done ? " done" : ""}${statusClass(status)}`}
      data-task-id={task.id}
      data-status={status}
    >
      <div className="card-title">{task.title}</div>
      {(labels.length > 0 || task.deadline || milestone || warnings.length > 0) && (
        <div className="card-meta">
          {labels.map((l) => (
            <span key={l.id} className={`chip chip-${l.color}`}>
              {l.name}
            </span>
          ))}
          <DeadlineBadge date={task.deadline} today={ctx.today} nearWindow={ctx.nearWindow} closed={done} />
          {milestone && <span className="milestone-tag">◆ {milestone.title}</span>}
          {warnings.map((w) => (
            <span key={w} className="warning" title={WARNING_TEXT[w]}>
              ⚠ {w === "end-after-deadline" ? "end > deadline" : "after milestone"}
            </span>
          ))}
        </div>
      )}
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
