import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import "./styles/tokens.css";
import "./styles/app.css";
import { bootStore } from "./app/store";
import { browserPersistence, isTauri, memoryPersistence, tauriPersistence } from "./storage/persistence";
import { StoreContext } from "./ui/useStore";
import { App } from "./ui/App";

async function main() {
  const root = createRoot(document.getElementById("root")!);
  try {
    // In the app: the real file. In a plain browser (development): localStorage, or memory with ?memory.
    const persistence = isTauri()
      ? await tauriPersistence()
      : new URLSearchParams(location.search).has("memory")
        ? memoryPersistence()
        : browserPersistence();
    const store = await bootStore(persistence, { sqlConfig: { locateFile: () => wasmUrl } });
    (window as any).__tracklet = store; // for debugging in the dev preview
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
