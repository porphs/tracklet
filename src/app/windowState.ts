import type { Store } from "./store";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Parses the saved bounds; anything malformed or tiny is ignored. */
export function parseBounds(value: string | undefined): Bounds | null {
  if (!value) return null;
  try {
    const b = JSON.parse(value);
    const ok = ["x", "y", "width", "height"].every((k) => typeof b[k] === "number" && Number.isFinite(b[k]));
    if (!ok || b.width < 400 || b.height < 300) return null;
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  } catch {
    return null;
  }
}

/**
 * Restores the window's last size and position, then saves them (debounced) whenever the
 * window moves or resizes. Stored in the `setting` table as `window_bounds` (spec §4).
 */
export async function rememberWindowBounds(store: Store): Promise<void> {
  const { getCurrentWindow, LogicalPosition, LogicalSize } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  const saved = parseBounds(store.repo.getSetting("window_bounds"));
  if (saved) {
    await win.setSize(new LogicalSize(saved.width, saved.height));
    await win.setPosition(new LogicalPosition(saved.x, saved.y));
  }
  let timer: number | undefined;
  const save = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const scale = await win.scaleFactor();
      const pos = (await win.outerPosition()).toLogical(scale);
      const size = (await win.outerSize()).toLogical(scale);
      const value = JSON.stringify({
        x: Math.round(pos.x),
        y: Math.round(pos.y),
        width: Math.round(size.width),
        height: Math.round(size.height),
      });
      if (value !== store.repo.getSetting("window_bounds")) store.mutate((r) => r.setSetting("window_bounds", value));
    }, 500);
  };
  await win.onResized(save);
  await win.onMoved(save);
}
