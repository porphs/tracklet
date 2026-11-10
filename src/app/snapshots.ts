import type { Persistence } from "../storage/persistence";
import type { DateStr } from "../domain/types";

/** How many snapshot files to keep in backups/ (ADR 0002). */
export const SNAPSHOT_KEEP = 14;

/** `tracklet-YYYYMMDD-HHMMSS-<reason>.db`: sorts by time as plain text. */
export function snapshotName(reason: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `tracklet-${stamp}-${reason}.db`;
}

const SNAPSHOT_RE = /^tracklet-\d{8}-\d{6}-[a-z0-9-]+\.db$/;

/** Which snapshot files to delete so only the newest `keep` remain. Ignores unrelated files. */
export function snapshotsToPrune(names: string[], keep = SNAPSHOT_KEEP): string[] {
  return names
    .filter((n) => SNAPSHOT_RE.test(n))
    .sort()
    .reverse()
    .slice(keep);
}

/** True when no snapshot was taken on `today` (local date). */
export function needsDailySnapshot(names: string[], today: DateStr): boolean {
  const prefix = `tracklet-${today.replace(/-/g, "")}-`;
  return !names.some((n) => SNAPSHOT_RE.test(n) && n.startsWith(prefix));
}

/** Copies the saved database into backups/ and prunes old snapshots. Returns the name, or null if nothing to copy. */
export async function takeSnapshot(p: Persistence, reason: string, now: Date): Promise<string | null> {
  const name = snapshotName(reason, now);
  const made = await p.createBackup(name);
  for (const old of snapshotsToPrune(await p.listBackups())) await p.deleteBackup(old);
  return made ? name : null;
}
