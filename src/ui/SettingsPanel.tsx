import { useEffect, useState } from "react";
import { useStore } from "./useStore";
import { usePanelEsc } from "./usePanelEsc";
import { MAX_NEAR_WINDOW, MIN_NEAR_WINDOW } from "../domain/deadline";

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const store = useStore();
  const [draft, setDraft] = useState(String(store.repo.nearWindow()));
  const [location, setLocation] = useState("");
  usePanelEsc(onClose);

  useEffect(() => {
    store.persistence.location().then(setLocation, () => setLocation("unknown"));
  }, [store]);

  return (
    <aside className="panel" aria-label="Settings">
      <div className="panel-header">
        <h2>Settings</h2>
        <button onClick={onClose}>Close</button>
      </div>
      <label className="field">
        <span>
          “Due soon” window: deadlines within this many days are highlighted ({MIN_NEAR_WINDOW}–{MAX_NEAR_WINDOW})
        </span>
        <input
          type="number"
          aria-label="Near window in days"
          min={MIN_NEAR_WINDOW}
          max={MAX_NEAR_WINDOW}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            const n = Number(e.target.value);
            if (e.target.value !== "" && Number.isFinite(n)) store.mutate((r) => r.setNearWindow(n));
          }}
          onBlur={() => setDraft(String(store.repo.nearWindow()))}
        />
      </label>
      <div className="field">
        <span>Your data is stored in</span>
        <code>{location}</code>
      </div>
    </aside>
  );
}
