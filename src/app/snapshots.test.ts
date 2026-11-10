import { describe, expect, it } from "vitest";
import { SNAPSHOT_KEEP, needsDailySnapshot, snapshotName, snapshotsToPrune, takeSnapshot } from "./snapshots";
import { memoryPersistence } from "../storage/persistence";
import { bootStore } from "./store";

const nameFor = (day: number, hh = 9) => snapshotName("daily", new Date(2026, 10, day, hh, 0, 0));

describe("AC6.5: pruning keeps the newest 14", () => {
  it("deletes exactly the oldest beyond 14, ignoring other files", () => {
    const names = Array.from({ length: 20 }, (_, i) => nameFor(i + 1)).reverse();
    const extra = ["notes.txt", "tracklet.db"];
    const del = snapshotsToPrune([...names, ...extra]);
    expect(del).toHaveLength(20 - SNAPSHOT_KEEP);
    expect(del.sort()).toEqual(Array.from({ length: 6 }, (_, i) => nameFor(i + 1)).sort());
    expect(del).not.toContain("notes.txt");
    expect(snapshotsToPrune(names.slice(0, 14))).toEqual([]);
  });

  it("takeSnapshot prunes after copying", async () => {
    const p = memoryPersistence(new Uint8Array([1]));
    for (let d = 1; d <= 16; d++) await takeSnapshot(p, "daily", new Date(2026, 10, d, 8));
    expect(p.backups.size).toBe(14);
    expect([...p.backups.keys()].sort()[0]).toBe(nameFor(3, 8));
  });
});

describe("AC6.6: daily snapshot decision", () => {
  it("true only when no snapshot exists for today", () => {
    expect(needsDailySnapshot([], "2026-11-10")).toBe(true);
    expect(needsDailySnapshot([nameFor(9)], "2026-11-10")).toBe(true);
    expect(needsDailySnapshot([nameFor(10)], "2026-11-10")).toBe(false);
    expect(needsDailySnapshot([snapshotName("pre-import", new Date(2026, 10, 10, 23))], "2026-11-10")).toBe(false);
  });

  it("boot takes one daily snapshot per day, only when data already existed", async () => {
    const p = memoryPersistence();
    let now = new Date(2026, 10, 10, 9);
    const clock = { now: () => now };
    await bootStore(p, { clock }); // first launch: nothing to copy yet
    expect(p.backups.size).toBe(0);
    await bootStore(p, { clock }); // second launch same day
    await bootStore(p, { clock }); // third launch same day
    expect([...p.backups.keys()]).toEqual(["tracklet-20261110-090000-daily.db"]);
    now = new Date(2026, 10, 11, 8);
    await bootStore(p, { clock });
    expect(p.backups.size).toBe(2);
  });
});
