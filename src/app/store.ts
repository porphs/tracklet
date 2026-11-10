import type { SqlJsConfig } from "sql.js";
import { Repository, systemClock, type Clock } from "../data/repository";
import { migrate, pendingMigrations } from "../storage/migrations";
import { openDatabase } from "../storage/open";
import type { Persistence } from "../storage/persistence";
import type { Sql } from "../storage/sql";
import { toLocalDate } from "../domain/dates";
import type { DateStr } from "../domain/types";

/**
 * Owns the open database. Every change goes through `mutate`, which notifies the UI
 * and saves to disk. Saves are serialised so they can never overlap or arrive out of order.
 */
export class Store {
  readonly repo: Repository;
  private listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();
  private dirty = false;
  version = 0;
  lastSaveError: string | null = null;

  constructor(
    readonly sql: Sql,
    readonly persistence: Persistence,
    /** Mutable so the dev preview can simulate another day (spec AC3.10). */
    public clock: Clock = systemClock,
  ) {
    this.repo = new Repository(sql, { now: () => this.clock.now() });
  }

  /** Today's local date on this Mac. */
  today(): DateStr {
    return toLocalDate(this.clock.now());
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = (): number => this.version;

  private emit(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  /** Runs a change, refreshes the UI and saves. Errors from `fn` propagate and nothing is saved. */
  mutate<T>(fn: (repo: Repository) => T): T {
    const result = fn(this.repo);
    this.emit();
    this.scheduleSave();
    return result;
  }

  /** Re-renders without changing data (e.g. "today" rolled over). */
  refresh(): void {
    this.emit();
  }

  private scheduleSave(): void {
    if (this.dirty) return; // a save is already queued and will pick up this change
    this.dirty = true;
    this.saving = this.saving.then(async () => {
      this.dirty = false;
      try {
        await this.persistence.save(this.sql.export());
        if (this.lastSaveError) {
          this.lastSaveError = null;
          this.emit();
        }
      } catch (e) {
        this.lastSaveError = String(e);
        this.emit();
      }
    });
  }

  /** Resolves once everything changed so far is on disk. */
  flush(): Promise<void> {
    return this.saving;
  }
}

export function backupName(reason: string, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `tracklet-${stamp}-${reason}.db`;
}

/**
 * Opens the saved database, snapshots it before any migration, migrates, seeds on first launch,
 * and saves. Throws NewerDatabaseError (without touching anything) if the data is from a newer app.
 */
export async function bootStore(
  persistence: Persistence,
  opts: { sqlConfig?: SqlJsConfig; clock?: Clock } = {},
): Promise<Store> {
  const clock = opts.clock ?? systemClock;
  const bytes = await persistence.load();
  const sql = await openDatabase(bytes, opts.sqlConfig);
  const pending = pendingMigrations(sql);
  if (pending.length && bytes) {
    await persistence.createBackup(backupName(`pre-migration-v${pending[pending.length - 1].version}`, clock.now()));
  }
  migrate(sql);
  const store = new Store(sql, persistence, clock);
  const seeded = store.repo.seedIfEmpty();
  if (pending.length || !bytes || seeded) await persistence.save(sql.export());
  return store;
}
