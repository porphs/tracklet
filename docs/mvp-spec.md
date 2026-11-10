# Tracklet: MVP spec

Terms are defined in [CONTEXT.md](../CONTEXT.md). Decisions are in [docs/adr/](adr/).
Stack: Tauri 2 + React + TypeScript + SQLite ([ADR 0001](adr/0001-tauri-react-typescript-sqlite.md)).
Data safety: [ADR 0002](adr/0002-data-safety-backups-and-migrations.md).

Acceptance criteria (AC) are tagged **[unit]** when they are checked by automated tests on the logic/data layer, and **[app]** when they are checked by running the app (browser preview and/or the Tauri build).

---

## 1. Data model

All IDs are UUID strings. All dates are local calendar dates stored as `YYYY-MM-DD` text, with no time of day. Timestamps are ISO-8601 text.

| Table | Fields | Notes |
|---|---|---|
| `board` | id, name, position, created_at, updated_at | `name` is non-empty. `position` sets the sidebar order. |
| `board_column` | id, board_id, name, position, is_done_column | `is_done_column` is a boolean. |
| `task` | id, board_id, column_id, title, description, start_date?, end_date?, deadline?, milestone_id?, position, created_at, updated_at | `position` is the order within its column. |
| `milestone` | id, board_id, title, description, date, is_reached, created_at, updated_at | `date` is **required**. |
| `label` | id, board_id, name, color | `color` is one of 8 fixed palette keys. |
| `task_label` | task_id, label_id | Many-to-many. |
| `setting` | key, value | `near_window_days` (default 3), `last_board_id`, `last_view`, `window_bounds`. |
| `schema_version` | version | Single row. |

**Rules (enforced in the logic layer, [unit])**
- R1: Title and board name are trimmed and must not be empty. Label name too.
- R2: If both `start_date` and `end_date` are set, `end_date >= start_date`. Any date may be set without the others.
- R3: A task's column, milestone and labels must all belong to the task's board.
- R4: Deleting a milestone sets `milestone_id = null` on its tasks. Deleting a label removes its `task_label` rows. Deleting a task removes its `task_label` rows. Deleting a board removes everything on it.
- R5: A column that contains tasks cannot be deleted.
- R6: Positions within a column (tasks), within a board (columns) and in the sidebar (boards) are always 0…n-1 with no gaps after any operation.
- R7: Label names are unique within a board, ignoring case and surrounding spaces. (The label filter matches by name, so duplicates would be ambiguous.)

## 2. Derived logic ([unit])

**Done**: a task is done when its column has `is_done_column = true`.

**Deadline status** of a task (from its `deadline`) or a milestone (from its `date`), given `today` and `N = near_window_days`:
- `none` if there is no date, the task is done, or the milestone is reached
- `overdue` if date < today
- `near` if today ≤ date ≤ today + N
- `none` otherwise

**Task warnings** (extra markers, independent of status, not shown when done):
- `end-after-deadline`: end_date and deadline are both set and end_date > deadline
- `after-milestone`: the task has a deadline, its milestone is set, and deadline > milestone.date

**Board counts**: the number of tasks and open milestones on the board with status `overdue`, and the number with status `near`.

**Label filter** applies to tasks only. Milestones have no labels, so they always show on the Timeline and Calendar.

**Today** is the Mac's local date. It is recalculated on launch, when the window gains focus, and every minute, so the day rolling over updates statuses without a restart.

---

## 3. Features and acceptance criteria, by slice

### Slice 1: skeleton, database, data model, task CRUD

Features: the app launches; the database is created at `~/Library/Application Support/local.tracklet.app/tracklet.db`; migrations run; on first launch the app seeds one board, "My board", with To do / Doing / Done (Done is a done column); task create / read / update / delete through the logic layer; a minimal UI to see and edit tasks; the auto-saving details panel.

- AC1.1 [unit] A fresh database migrates to the latest version, and `schema_version` matches.
- AC1.2 [unit] Seeding runs only when there are no boards. It creates "My board" with 3 columns in order, and only "Done" is a done column.
- AC1.3 [unit] Creating a task with a blank title fails. A valid task gets an id, timestamps and the last position in its column.
- AC1.4 [unit] Updating a task enforces R2 and R3 and refreshes `updated_at`.
- AC1.5 [unit] Deleting a task removes it and its label links (R4). Undo restores the task, its position and its label links exactly.
- AC1.6 [unit] Migrating a database that is newer than the app is refused with a clear error, and the database is unchanged.
- AC1.7 [unit] A failing migration rolls back, leaving the version and data unchanged.
- AC1.8 [app] After quitting and relaunching, tasks are still there. The database file exists at the path above.
- AC1.9 [app] In the details panel, edits save without a Save button (they're still there after closing and reopening the panel), and Esc closes the panel.

### Slice 2: Board view  **[STOP for manual testing after this slice]**

Features: a sidebar of boards (create, rename, reorder by drag, delete with typed-name confirmation, switch); columns (add, rename, reorder by drag, delete if empty, toggle done column); cards with title, label chips (placeholder until slice 3), deadline badge (placeholder until slice 3) and milestone tag; "+ Add task" per column; drag cards between and within columns; delete task with confirm + 10-second undo; the last board and view are remembered.

- AC2.1 [unit] Moving a task within a column or to another column updates positions per R6, and the moved task ends up at the requested index.
- AC2.2 [unit] Reordering columns and boards keeps positions per R6.
- AC2.3 [unit] Deleting a non-empty column is rejected (R5). Deleting an empty one closes the position gap.
- AC2.4 [unit] Deleting a board removes all of its columns, tasks, milestones, labels and label links, and no other board's data.
- AC2.5 [app] Dragging a card to another column and relaunching shows it in the new column at the same index.
- AC2.6 [app] "+ Add task", typing a title and pressing Enter adds the card at the bottom and keeps the input open. Pressing Enter on an empty input does nothing.
- AC2.7 [app] Deleting a board requires typing its exact name. The button stays disabled otherwise.
- AC2.8 [app] After deleting a task, an "Undo" bar appears for about 10 seconds. Clicking it restores the card in its original place.
- AC2.9 [app] Relaunching opens the last board and the last view.
- AC2.10 [app] Moving a card into a done column makes it show as done (faded) immediately. Moving it out restores it.

### Slice 3: Deadlines, milestones and labels

Features: start, end and deadline date fields in the details panel; deadline status and warnings shown on cards (colour + text badge, e.g. "Overdue 2d", "Due today", "Due in 1d"); board header counts; Settings with the near window (1–30 days); a Milestones panel per board (add, edit, mark reached, delete with confirm + undo); assigning a milestone to a task; per-board labels (name + 8-colour palette, manage panel, assign in the details panel, delete with confirm + undo); a label filter on the Board view.

- AC3.1 [unit] The deadline status function returns the correct value for: no date; yesterday; today; today+N; today+N+1; done task with a past deadline; reached milestone with a past date. Tested with N = 3 and N = 7.
- AC3.2 [unit] `end-after-deadline` and `after-milestone` warnings fire exactly per §2 and never for done tasks.
- AC3.3 [unit] Board counts match a fixture with a known mix of statuses.
- AC3.4 [unit] Deleting a milestone unlinks its tasks without deleting them, and undo re-links them.
- AC3.5 [unit] Deleting a label removes it from its tasks, and undo restores the links.
- AC3.6 [unit] Assigning a milestone or label from another board is rejected (R3). A duplicate label name on the same board is rejected (R7).
- AC3.7 [unit] Filtering by label returns only tasks that have that label. In All-boards scope it matches by label name across boards.
- AC3.8 [app] An overdue card shows a red marker and an "Overdue Nd" badge, and a near card shows amber with "Due today" or "Due in Nd". Both are readable without relying on colour.
- AC3.9 [app] Changing the near window in Settings updates the badges and counts at once and persists after relaunch.
- AC3.10 [app] When the date changes while the app is open (simulated by changing the clock in the preview), statuses update within a minute.

### Slice 4: Calendar view

Features: a month grid starting Monday; task deadlines and milestones (◆) on their days with the shared status colours; done/reached items faded; "+N more" after 3 items, which opens a day list; clicking an item opens the details panel (task) or milestone editor; double-clicking an empty part of a day creates a task on the current board, in its first column, with that day as its deadline; prev / next / Today; today's cell is outlined; scope toggle (current board / All boards, with a board-name prefix in All); label filter.

- AC4.1 [unit] The month grid function returns whole weeks Monday→Sunday covering the month, including leading and trailing days from neighbouring months (tested on a month starting on Monday, one starting on Sunday, and February in a leap year).
- AC4.2 [unit] Items-for-day returns task deadlines and milestone dates for that day, respecting scope and the label filter. Start/end dates are never included.
- AC4.3 [app] A task with deadline 2026-11-20 appears on that cell and nowhere else. Changing its deadline in the panel moves it right away.
- AC4.4 [app] Double-clicking an empty part of a day creates a task with that deadline in the first column and opens it in the panel.
- AC4.5 [app] Overdue, near and done items look the same as their Board counterparts.
- AC4.6 [app] With All boards on, items from every board appear, each prefixed with its board name.

### Slice 5: Timeline view  **[STOP for manual testing after this slice]**

Features: a left task list plus a date grid; a task with only one planned date (start or end) draws a one-day bar on that date; rows grouped by milestone (milestones by date, then "No milestone"), and in All-boards scope by board first; each milestone diamond on its group header; tasks sorted by start date, then deadline; a start→end bar, a deadline tick after the end, and a marker for a deadline-only task; tasks with no dates are hidden; a today line; Day / Week / Month zoom; a Today button; status colours, with done tasks faded; click a bar, marker or diamond to open the editor; scope toggle and label filter. No dragging in this slice (added after the MVP, see Slice 8).

- AC5.1 [unit] The row-building function groups and sorts tasks as described and leaves out tasks with no dates.
- AC5.2 [unit] The date→x mapping is correct at each zoom level. A bar's start x and width match its start and end (inclusive of the end day).
- AC5.3 [unit] The visible range covers every shown date plus padding, and always includes today.
- AC5.4 [app] A task with start 2026-11-10 and end 2026-11-14 draws a 5-day bar. Adding deadline 2026-11-17 adds a tick 3 days after the bar's end.
- AC5.5 [app] Switching zoom keeps the view centred on the same date. "Today" scrolls the today line into view.
- AC5.6 [app] Clicking a bar opens the same details panel as the Board, and edits there update the bar right away.
- AC5.7 [app] Milestone diamonds appear on their dates, coloured by status, and clicking one opens the milestone editor.

### Slice 6: Export / import and snapshots

Features: **Export** (sidebar) writes all data as JSON to `~/Downloads/tracklet-export-YYYYMMDD-HHMMSS.json` and reveals it in Finder; **Import** (sidebar) opens the system file picker, then validates, confirms, snapshots, and replaces all data. (We skip a Save dialog so no dialog plugin is needed, keeping ADR 0001's dependency list unchanged.) Automatic snapshots (on the first launch each day, before migrations, before imports), keeping the newest 14 in `backups/`.

- AC6.1 [unit] Export → import into an empty database → export gives identical JSON, ignoring `exportedAt`.
- AC6.2 [unit] Import rejects: invalid JSON; a missing `formatVersion`; a newer `formatVersion`; dangling references (a task pointing to a missing column, milestone or label, or across boards). After a rejected import the database is unchanged.
- AC6.3 [unit] Import of a valid file replaces all existing data in one transaction. Nothing from before survives.
- AC6.4 [unit] The format upgrade function turns a v1 export fixture into the current shape (once there is more than one version).
- AC6.5 [unit] The snapshot pruning function keeps exactly the newest 14 and deletes the rest.
- AC6.6 [unit] The daily-snapshot decision is true only when no snapshot exists for today's date.
- AC6.7 [app] Export, then delete a board, then import the file: the board is back with all its tasks.
- AC6.8 [app] After an import, a new snapshot file exists in `backups/`.
- AC6.9 [app] Export creates the file in Downloads and shows its path; the file opens in Finder.

### Slice 8: Timeline dragging (post-MVP)

Features: on the Timeline, drag to change dates instead of opening the panel. Everything snaps to whole days, and the change is saved once, when the mouse is released. While dragging, the new dates are shown next to the item.

- **Move a bar**: shifts the planned dates (start and end) by the same number of days. A task with only one planned date shifts only that date. The deadline does **not** move; if the bar ends up past it, the usual "end > deadline" warning shows.
- **Resize a bar**: drag its left end to change the start date, or its right end to change the end date. The ends cannot cross (a bar is at least one day). Resizing a one-date bar writes both dates, so the task keeps exactly the bar you see. Bars narrower than 24px have no resize ends (they can only be moved).
- **Move a deadline** (tick or dot) or a **milestone diamond**: changes that date.
- **Pan**: dragging empty chart space scrolls the view.
- A press that moves less than 4px is a click, and opens the editor as before. Esc during a drag cancels it. Done tasks and reached milestones can be dragged too.
- No undo for drags (same as editing dates in the panel); drag back or edit in the panel.

- AC8.1 [unit] The drag-to-dates function: moving shifts start and end (or only the date that is set) by the day delta, and never the deadline; resizing changes one end and clamps so start ≤ end; resizing a one-date bar sets both dates; a zero delta changes nothing.
- AC8.2 [unit] The pixels-to-days function rounds to the nearest whole day at each zoom.
- AC8.3 [app] Dragging the 2026-11-10 → 2026-11-14 bar two days right (week zoom) saves 2026-11-12 → 2026-11-16 and leaves its deadline unchanged.
- AC8.4 [app] Dragging a bar's right end changes only the end date; dragging a deadline tick or a milestone diamond changes only that date, and the Board and Calendar show the new date.
- AC8.5 [app] A short click on a bar still opens the panel. Esc mid-drag leaves the dates as they were.
- AC8.6 [app] Dragging empty chart space scrolls the view; the dates of nothing change.

### Phase 3: Packaging

- AC7.1 `npm run tauri build` produces `Tracklet.app` and a `.dmg` (Apple Silicon), ad-hoc signed.
- AC7.2 Copying `Tracklet.app` into /Applications and opening it (right-click → Open the first time) launches the app with existing data.
- AC7.3 The README covers: prerequisites, dev run, tests, build, install, where data lives, export/import, and restoring from a snapshot by hand.

---

## 4. UI rules for the MVP

- The look follows the post-MVP redesign: teal accent, the bundled Anuphan font (offline), rounded surfaces. Light only; no animations or theming.
- All colours, spacing and sizes come from one stylesheet of CSS variables (`src/styles/tokens.css`), and components use those variables only, to keep the redesign cheap.
- Status colours: overdue = red, near = amber, done = faded (reduced opacity). There is always a text badge alongside the colour.
- Label palette: 8 fixed colours, defined in the same stylesheet.
- The window remembers its size and position (stored in `setting`, using Tauri's window API, so no extra dependency).

## 5. Out of scope for the MVP

Checklists/subtasks, priority, attachments, comments, time tracking, recurring tasks; archive; times of day; Markdown descriptions; global search; notifications/reminders; per-board export, merge-import, in-app snapshot restore, iCloud or custom backup folder; Calendar week view; keyboard card moves and extra shortcuts; printing; **moving a task to another board**; sync, accounts, multi-user, mobile, Windows/Linux; Developer ID signing, notarisation, auto-update; theming, dark mode or animations.
