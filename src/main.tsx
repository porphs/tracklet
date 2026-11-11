import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import "./styles/tokens.css";
import "./styles/app.css";
import { bootStore } from "./app/store";
import { browserPersistence, isTauri, memoryPersistence, tauriPersistence } from "./storage/persistence";
import { StoreContext } from "./ui/useStore";
import { App } from "./ui/App";
import { rememberWindowBounds } from "./app/windowState";
import { TodayPopover } from "./ui/TodayPopover";

/** Which window this webview is: the main app, or the menu bar "Today" popover. */
async function windowLabel(): Promise<string> {
  if (!isTauri()) return new URLSearchParams(location.search).get("window") ?? "main";
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow().label;
}

async function mainToday(root: ReturnType<typeof createRoot>) {
  const persistence = isTauri() ? await tauriPersistence() : browserPersistence();
  const call = async (cmd: string, args?: Record<string, unknown>) => {
    if (!isTauri()) return console.info(cmd, args); // dev preview: nothing to switch to
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke(cmd, args);
  };
  const onClose = () => void call("hide_today");
  root.render(
    <StrictMode>
      <TodayPopover
        persistence={persistence}
        sqlConfig={{ locateFile: () => wasmUrl }}
        onOpenTask={(id) => void call("open_task", { id })}
        onClose={onClose}
      />
    </StrictMode>,
  );
}

async function main() {
  const root = createRoot(document.getElementById("root")!);
  if ((await windowLabel()) === "today") return mainToday(root);
  try {
    // In the app: the real file. In a plain browser (development): localStorage, or memory with ?memory.
    const persistence = isTauri()
      ? await tauriPersistence()
      : new URLSearchParams(location.search).has("memory")
        ? memoryPersistence()
        : browserPersistence();
    const store = await bootStore(persistence, { sqlConfig: { locateFile: () => wasmUrl } });
    if (!isTauri()) (window as any).__tracklet = store; // for debugging in the dev preview only
    else rememberWindowBounds(store).catch((e) => console.warn("window bounds:", e));
    root.render(
      <StrictMode>
        <StoreContext.Provider value={store}>
          <App />
        </StoreContext.Provider>
      </StrictMode>,
    );
  } catch (e) {
    root.render(
      <div className="fatal" role="alert">
        <h1>Tracklet could not open your data</h1>
        <p>{e instanceof Error ? e.message : String(e)}</p>
        <p className="muted">Nothing was changed.</p>
      </div>,
    );
  }
}

main();
