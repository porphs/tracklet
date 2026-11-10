import { useEffect } from "react";

/** Esc closes the panel, unless a dialog is open (it handles Esc itself) or focus is in an inline editor. */
export function usePanelEsc(onClose: () => void, disabled = false): void {
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if ((e.target as HTMLElement | null)?.classList?.contains("inline-edit")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, disabled]);
}
