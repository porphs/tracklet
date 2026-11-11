# Tracklet

A personal, offline task tracker for macOS: boards with columns and cards, a Gantt-style
timeline, and a month calendar, all over the same local data. One user, no accounts, no sync,
no server.

**Menu bar.** Tracklet adds an icon to the macOS menu bar. Click it to see today's tasks: open
tasks whose planned start–end dates include today, grouped by board. Click a task to open it in
the main window. Right-click the icon for Open / Quit. Closing the main window only hides it, so
the icon keeps working; ⌘Q quits.

- Product brief: [docs/idea.md](docs/idea.md)
- Spec and acceptance criteria: [docs/mvp-spec.md](docs/mvp-spec.md)
- Glossary: [CONTEXT.md](CONTEXT.md)
- Decisions: [docs/adr/](docs/adr/)

## Install the built app

1. Open `src-tauri/target/release/bundle/dmg/Tracklet_0.1.0_aarch64.dmg` and drag **Tracklet** into
   **Applications**. (Or copy `src-tauri/target/release/bundle/macos/Tracklet.app` there directly.)
2. The first time, **right-click Tracklet → Open**, then confirm. The app is ad-hoc signed and not
   notarised (no Apple Developer ID), so a normal double-click is blocked by Gatekeeper once.
   After that it opens normally.

The build is for Apple Silicon (arm64), macOS 13 or later.

## Where your data lives

```
~/Library/Application Support/local.tracklet.app/
├── tracklet.db          ← all your data (one SQLite file)
└── backups/             ← automatic snapshots (newest 14 kept)
    └── tracklet-YYYYMMDD-HHMMSS-<reason>.db
```

Settings (in the sidebar) also shows the data folder's path.

## Backing up

**Automatic snapshots.** Tracklet copies `tracklet.db` into `backups/`:
- on the first launch of each day (`…-daily.db`),
- before every database upgrade (`…-pre-migration-vN.db`),
- before every import (`…-pre-import.db`).

Only the newest 14 are kept. Snapshots live on the same disk, so they protect against mistakes,
not against losing the Mac. Time Machine picks up this folder like any other.

**Export (portable JSON).** Sidebar → **Export…** writes
`~/Downloads/tracklet-export-YYYYMMDD-HHMMSS.json` and shows it in Finder. The file is readable
JSON containing every board, column, task, milestone, label and setting. Keep it somewhere safe
(another disk, cloud storage).

## Restoring

**From an export file (recommended).** Sidebar → **Import…** → choose the `.json` file. Tracklet
checks the whole file first. If anything is wrong, it tells you why and changes nothing. If it is
fine, it asks you to confirm, saves a `pre-import` snapshot of your current data, and then
**replaces all data** with the file's contents. Import never merges.

**From a snapshot (manual).**
1. Quit Tracklet (⌘Q).
2. In Finder, press ⌘⇧G and go to `~/Library/Application Support/local.tracklet.app/`.
3. Optional: rename the current `tracklet.db` to `tracklet-broken.db` to keep it.
4. Copy the snapshot you want from `backups/` next to it and rename the copy to `tracklet.db`.
5. Open Tracklet.

Or in Terminal:

```bash
cd ~/Library/Application\ Support/local.tracklet.app
cp tracklet.db tracklet-before-restore.db
cp backups/tracklet-20261110-090000-daily.db tracklet.db   # pick your snapshot
```

**Start completely fresh.** Quit Tracklet and move `tracklet.db` out of that folder. On the next
launch, Tracklet creates a new database with one board, "My board".

If you open data that was saved by a *newer* Tracklet with an older app, the older app refuses to
open it (and changes nothing) rather than risk damaging it.

## Developing

### Prerequisites

- macOS with Xcode command-line tools
- Node.js 20.19+ (or 22+) and npm
- Rust (stable), installed with [rustup](https://rustup.rs). A new terminal picks it up
  automatically; in an old one run `source ~/.cargo/env`.

```bash
npm install
```

### Run

```bash
npx tauri dev
```

This opens the app window with live reload, using the real data folder above.

To work on the UI in a browser instead (no Rust needed):

```bash
npm run dev
```

Then open http://localhost:1420 (data kept in the browser's localStorage), or
http://localhost:1420/?memory (a throwaway in-memory database).

### Test

```bash
npm test
```

```bash
npm run typecheck
```

Unit tests (Vitest) cover the data and logic layer: rules, migrations, deadline status, calendar
grid, timeline layout, export/import validation and snapshot pruning. They run against a real
in-memory SQLite (sql.js).

### Build the app

```bash
npx tauri build
```

The output lands in `src-tauri/target/release/bundle/`, as `macos/Tracklet.app` and
`dmg/Tracklet_0.1.0_aarch64.dmg`.

### Project layout

```
src/domain/    pure logic: dates, deadline status, filter, calendar grid, timeline layout
src/data/      repository (all reads/writes + rules) and export/import
src/storage/   sql.js wrapper, migrations, persistence (Tauri file / browser / memory)
src/app/       store (change → save), snapshots, window size memory
src/ui/        React components
src/styles/    tokens.css (every colour/size) + app.css (layout); restyle here
src/styles/fonts/  Anuphan (latin subset, SIL OFL), bundled so the app needs no network
src-tauri/     the native shell: a few std-only file commands, nothing else
```

### Changing the database schema

Add a new entry to `MIGRATIONS` in `src/storage/migrations.ts`. Never edit a shipped one.
Migrations run in a transaction at startup, after an automatic snapshot. If the export format
changes, bump `FORMAT_VERSION` in `src/data/backup.ts` and add an upgrade step, so old exports
still import.
