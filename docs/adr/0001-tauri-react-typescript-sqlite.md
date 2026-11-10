---
status: accepted
---

# Tauri 2 + React + TypeScript + SQLite

The app is a Tauri 2 desktop shell around a React + TypeScript frontend, with data kept in a single SQLite file in `~/Library/Application Support/local.tracklet.app/`. We chose this over Electron because the app is far smaller and lighter, and over SwiftUI because a web UI is much easier to hand-build drag/drop, a Gantt timeline and a calendar in, much easier to restyle later, and can be checked in a browser during development. The cost is a one-time Rust toolchain install.

## Shape

- All domain logic (deadline status, ordering, validation, export/import) is pure TypeScript with no UI or storage imports, and it is unit-tested.
- Storage is SQLite through `sql.js` (WebAssembly) **everywhere**: in the app, in tests and in the browser preview, so the same engine, SQL and migrations run in all three. In the app, the database file is read once at startup and written back after every change, using three small Rust commands built on `std::fs` only: read the file, write it atomically (temp file + rename), and copy it for snapshots. The browser preview keeps the database in memory (or in localStorage).
- Schema migrations are numbered SQL scripts in TypeScript, run by the storage layer at startup and tracked in a `schema_version` table.
- *Amended during slice 1:* we first planned `@tauri-apps/plugin-sql`. It was dropped because it runs over a connection pool, so `BEGIN…COMMIT` sent as separate calls is not guaranteed to stay on one connection, and that breaks the all-or-nothing migrations and imports in ADR 0002. With sql.js, transactions are real, and a personal database is small enough that rewriting the whole file per change costs nothing noticeable.

## Pre-approved dependencies

Runtime: `react`, `react-dom`, `@tauri-apps/api`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `sql.js`.
Dev/build: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `@tauri-apps/cli`, `@types/react`, `@types/react-dom`, `@types/sql.js`.
Rust: `tauri`, `tauri-build`, `serde`, `serde_json` (what the standard Tauri template generates). No SQL crate.
Toolchain: Rust via the official `rustup` installer.

Anything else needs approval first. Timeline and calendar are hand-built: no Gantt or calendar library.

## Considered options

- **Electron**: same code and same dev story, but a 150–250 MB app with a bundled Chromium, and native-module rebuilds for SQLite.
- **SwiftUI**: the most native, but every view would be hand-built with weaker drag/drop support, a later redesign would be harder, and the UI can't be checked in a browser.
