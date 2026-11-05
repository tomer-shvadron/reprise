# ADR-0012: A library app, with metadata in IndexedDB through Dexie

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The trainer keeps a practice log per song, which only makes sense if a song's history
survives the file being moved or renamed. Guitar Pro is a document app: open and save files
anywhere, a recent-files list, no central store, and anything keyed by file path breaks on
the first rename.

The metadata to store is small: a library index, practice sessions, settings. Options were
IndexedDB through Dexie, which the owner used in a previous project, or SQLite, which in
Electron requires a native module rebuilt for Electron's Node version on every upgrade.

## Decision

- **Reprise is a library app.** An app-managed folder under the user's Music directory holds
  the songs as plain files. Importing a file copies it in and indexes it; every song gets a
  stable library ID that the practice log, per-track settings and sound pack assignments
  attach to.
- **Open without import** is available for one-off viewing of a file anywhere on disk.
- **Metadata lives in IndexedDB through Dexie**: library index, practice log, settings.
- **Downloaded sound packs live in the app's data directory**; decoded audio lives only in
  memory under the budget of ADR-0005.
- Nothing is locked inside the app: the library folder is ordinary files.

## Alternatives considered

- **Document app**: rejected because of path-keyed practice history and the lack of a single
  place to see what you have been working on.
- **SQLite**: more capable queries, but native module rebuilds for a dataset of a few hundred
  rows. Rejected.

## Consequences

- The web build keeps working through the platform adapter (ADR-0003): in the browser, the
  library folder maps to origin-private storage and Dexie is unchanged.
- The library screen is part of the library checkpoint in the build order, after the player
  checkpoint.
- Export to Guitar Pro formats (ADR-0008) writes outside the library folder by default, so
  the library remains native files plus the original imports.

## Related

- `../specs/shared-understanding.md`
- `0003-desktop-only-electron.md`
- `0005-memory-budgets-lazy-loading.md`
- `0008-file-formats.md`
