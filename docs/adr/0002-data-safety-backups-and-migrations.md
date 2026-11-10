---
status: accepted
---

# Data safety: JSON export, replace-only import, snapshots, forward-only migrations

This is a single-user app with one database file, so the safety model is about never losing data and never half-applying a change. It is not about syncing or merging.

- **Export** writes all data (every board, column, task, milestone, label and setting) to one JSON file with `formatVersion` and `exportedAt`.
- **Import replaces everything; it never merges.** The whole file is checked first (structure, known format version, links between records). If the check fails, nothing changes. If it passes, the user confirms, a snapshot is taken, and the data is swapped in one transaction. We rejected merging because it needs conflict rules that would never be worth it for one user on one machine.
- **Snapshots** are copies of the SQLite file in `backups/` next to the database. One is taken on the first launch of each day, one before every migration and one before every import. The newest 14 are kept. Restoring is a manual file copy, documented in the README.
- **Migrations** are forward-only and numbered, tracked in `schema_version`. Each runs in a transaction after a snapshot; if one fails, it rolls back and the app shows the error and the snapshot path. There are no down-migrations: going back means restoring a snapshot.
- **A database newer than the app is refused, not opened.** An older build must never write to a schema it doesn't understand.
- **Old exports stay importable**: each `formatVersion` has an upgrade step to the current shape. An export with a newer version than the app is rejected.
