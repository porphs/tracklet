import { useState } from "react";

interface Props {
  value: string;
  onSave: (value: string) => void;
  label: string;
  className?: string;
  /** Start in edit mode (e.g. right after creating something). */
  startEditing?: boolean;
  onCancel?: () => void;
}

/** Text that turns into an input on double-click. Enter or blur saves, Esc cancels. */
export function InlineEdit({ value, onSave, label, className, startEditing = false, onCancel }: Props) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <span
        className={className}
        title="Double-click to rename"
        onDoubleClick={() => {
          setDraft(value);
          setEditing(true);
        }}
      >
        {value}
      </span>
    );
  }

  const finish = (save: boolean) => {
    setEditing(false);
    if (save && draft.trim() && draft.trim() !== value) onSave(draft);
    if (!save) onCancel?.();
  };

  return (
    <input
      aria-label={label}
      className="inline-edit"
      value={draft}
      autoFocus
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}
