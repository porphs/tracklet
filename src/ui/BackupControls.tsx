import { useRef, useState } from "react";
import { useStore } from "./useStore";
import { useNotices } from "./notice";
import { ConfirmDialog } from "./ConfirmDialog";
import { applyImport, exportFileName, importSummary, parseImport, serializeExport, type ExportData } from "../data/backup";
import { takeSnapshot } from "../app/snapshots";

/** Sidebar Export / Import (spec slice 6, ADR 0002). */
export function BackupControls({ onImported }: { onImported: () => void }) {
  const store = useStore();
  const { notify } = useNotices();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ fileName: string; data: ExportData } | null>(null);
  const [lastExport, setLastExport] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      const now = store.clock.now();
      const path = await store.persistence.exportFile(exportFileName(now), serializeExport(store.sql, now));
      setLastExport(path);
      notify(`Exported to ${path}`);
      store.persistence.reveal(path).catch(() => {});
    } catch (e) {
      notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = parseImport(await file.text());
      setPending({ fileName: file.name, data });
    } catch (e) {
      notify(`Import refused, nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const doImport = async (data: ExportData) => {
    setBusy(true);
    try {
      await store.flush(); // the snapshot must contain everything up to now
      const snap = await takeSnapshot(store.persistence, "pre-import", store.clock.now());
      store.mutate(() => applyImport(store.sql, data));
      await store.flush();
      onImported();
      notify(`Imported ${importSummary(data)}.${snap ? ` Previous data saved as backups/${snap}.` : ""}`);
    } catch (e) {
      notify(`Import failed, nothing was changed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const current = () => {
    const n = (t: string) => store.sql.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
    return `${n("board")} board(s), ${n("task")} task(s)`;
  };

  return (
    <div className="sidebar-section">
      <div className="sidebar-heading">Backup</div>
      <button className="link-button" onClick={doExport} disabled={busy}>
        Export…
      </button>
      <button className="link-button" onClick={() => fileInput.current?.click()} disabled={busy}>
        Import…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Choose an export file to import"
        style={{ display: "none" }}
        onChange={(e) => onFile(e.target.files?.[0])}
      />
      {lastExport && (
        <div className="muted" title={lastExport}>
          Last export: {lastExport.split("/").pop()}
        </div>
      )}
      {pending && (
        <ConfirmDialog
          title="Replace all data?"
          message={`Importing “${pending.fileName}” (${importSummary(pending.data)}) will REPLACE everything currently in Tracklet (${current()}). A snapshot of the current data is saved first.`}
          confirmLabel="Replace all data"
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const d = pending.data;
            setPending(null);
            void doImport(d);
          }}
        />
      )}
    </div>
  );
}
