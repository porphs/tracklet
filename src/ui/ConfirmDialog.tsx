import { useEffect, useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  /** If set, the user must type this exactly before confirming. */
  requireTyping?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel, requireTyping, onConfirm, onCancel }: Props) {
  const [typed, setTyped] = useState("");
  const allowed = requireTyping === undefined || typed === requireTyping;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel]);

  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <p>{message}</p>
        {requireTyping !== undefined && (
          <label className="field">
            <span>Type “{requireTyping}” to confirm</span>
            <input value={typed} autoFocus onChange={(e) => setTyped(e.target.value)} />
          </label>
        )}
        <div className="dialog-actions">
          <button onClick={onCancel} autoFocus={requireTyping === undefined}>
            Cancel
          </button>
          <button className="danger" disabled={!allowed} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
