# Idea: Tracklet, a personal task tracker

## What it is

A Trello-style task tracker for exactly one person: me. It runs as a native-feeling
macOS desktop app, works entirely offline, and keeps its data in a local database
file under `~/Library/Application Support/local.tracklet.app/`. There are no accounts, no
login, no server, and no sync.

## Why

To track my own work, mark milestones, and give each task a deadline, then look at
that work from three angles without keeping three copies in sync.

## Three views over the same data

1. **Board**: columns of cards. Cards can be dragged between columns and reordered
   within a column.
2. **Timeline**: Gantt-style. Tasks with a start and end date show as horizontal bars;
   milestones show as diamonds. Zoom levels: day, week, month.
3. **Calendar**: month view (week view would be nice) showing deadlines and
   milestones. Clicking an item opens its details.

An edit in any view shows up in the other two right away, because they all read the
same records.

## Cross-cutting rule

A deadline that is **near** or **overdue** must stand out visually in every view.

## Constraints

- One user, one machine, fully offline.
- Function before form: plain, minimal UI for the MVP. A visual redesign comes later,
  in a separate effort, so styling has to live in one place.
- Data must be safe: backup/export and a plan for schema changes.

## Open questions (seen so far)

1. **Milestone**: is it its own kind of thing, or a task with a flag? Can tasks belong
   to a milestone, and does a milestone's date come from its tasks?
2. **Deadline vs. end date**: a task has a deadline, and the timeline needs start/end.
   Are "end date" and "deadline" the same field or different?
3. **Which tasks appear where**: a task with only a deadline (no start), what does the
   timeline draw? A task with no dates at all?
4. **"Near"**: how many days before a deadline counts as near? Fixed or configurable?
   Does "done" turn off the warning?
5. **Done**: is "done" a column, or a status separate from columns? What happens to a
   card's deadline warning when it moves to a "Done" column?
6. **Boards**: one board, or several boards/projects? If several, do timeline and
   calendar show one board or all of them?
7. **Columns**: fixed set (To do / Doing / Done) or user-defined?
8. **Task fields**: beyond title, dates and column, what else? Description, labels,
   checklist, priority?
9. **Archive and delete**: hard delete, or archive with a way back?
10. **Tech stack**: Tauri, Electron, or SwiftUI? (To be recorded as an ADR.)
11. **Backup**: JSON export/import? Automatic backups? Does import replace or merge?
12. **Schema changes**: how do migrations run, and is there a backup before them?
13. ~~App name~~: decided, Tracklet (`local.tracklet.app`).
14. **Out of scope**: what is explicitly not in the MVP?
