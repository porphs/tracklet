import { createContext, useContext } from "react";
import type { Deleted } from "../data/repository";

export interface Notices {
  /** Shows a short message (e.g. why an action was refused). */
  notify: (message: string) => void;
  /** Shows the "Deleted. Undo" bar for about 10 seconds. */
  offerUndo: (message: string, deleted: Deleted) => void;
  /** Runs a store change; a refused change shows its reason instead of throwing. */
  attempt: (fn: () => void) => boolean;
}

export const NoticeContext = createContext<Notices | null>(null);

export function useNotices(): Notices {
  const n = useContext(NoticeContext);
  if (!n) throw new Error("NoticeContext missing");
  return n;
}
