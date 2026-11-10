---
status: accepted
---

# Tauri 2 + React + TypeScript + SQLite

The app is a Tauri 2 desktop shell around a React + TypeScript frontend, with data kept in a single SQLite file in `~/Library/Application Support/local.tracklet.app/`. We chose this over Electron because the app is far smaller and lighter, and over SwiftUI because a web UI is much easier to hand-build drag/drop, a Gantt timeline and a calendar in, much easier to restyle later, and can be checked in a browser during development. The cost is a one-time Rust toolchain install.

## Shape

- All domain logic (deadline status, ordering, validation, export/import) is pure TypeScript with no UI or storage imports, and it is unit-tested.
- Storage sits behind one TypeScript interface that takes SQL. In the app it uses `@tauri-apps/plugin-sql` (SQLite). In tests and the browser preview it uses `sql.js` (in-memory SQLite, WebAssembly), so the same SQL and migrations run everywhere.
- Schema migrations are numbered SQL scripts in TypeScript, run by the storage layer at startup and tracked in a `schema_version` table. This keeps the Rust side to a minimal shell plus the plugin.

## Pre-approved dependencies

Runtime: `react`, `react-dom`, `@tauri-apps/api`, `@tauri-apps/plugin-sql`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `sql.js`.
Dev/build: `typescript`, `vite`, `@vitejs/plugin-react`, `vitest`, `@tauri-apps/cli`, `@types/react`, `@types/react-dom`, `@types/sql.js`.
Rust: `tauri`, `tauri-build`, `tauri-plugin-sql` (sqlite feature), plus what `create-tauri-app` generates.
Toolchain: Rust via the official `rustup` installer.

Anything else needs approval first. Timeline and calendar are hand-built: no Gantt or calendar library.

## Considered options

- **Electron**: same code and same dev story, but a 150–250 MB app with a bundled Chromium, and native-module rebuilds for SQLite.
- **SwiftUI**: the most native, but every view would be hand-built with weaker drag/drop support, a later redesign would be harder, and the UI can't be checked in a browser.
