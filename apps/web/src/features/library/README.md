# Library

**Owner**: the formats lane (`[P:formats]`). **Filled by**: WP-060 (library and import), WP-061
(save, export and autosave), and the schema migration of WP-073 (practice log).

Today it holds only the entry points the lead stubbed in WP-056:

| Export                           | What it is                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `LibraryScreen`                  | A placeholder naming WP-060. The app shows it over the score while `ui.screen` is `'library'`.           |
| `libraryCommands` (`./commands`) | `library.show` ("Show library"), which sets the screen. WP-060 adds open-without-import and the recents. |

## What it can rely on

- `document.songId`: the song a document was opened from, passed as `songId` in the options of
  `openBytes(name, bytes, { handle?, songId? })` and set later with `setSongId` after importing a file opened without import. Cleared by
  `close` and by the next open.
- `ui.screen` and `ui.setScreen`: the library is a full-window screen; leaving it sets `'player'`.
- `captureTrackSession`, `restoreTrackSession` and `watchTrackSession` from `features/tracks` for the
  per-song settings.
- The practice session shape (`state/practice.ts`) for the `practiceSessions` table of WP-073.

The Dexie schema file lives here and is owned by this lane, so WP-073 adds its table by migration
there. Needing another field on a shared store is a `type:contract` issue for the lead, not an edit.

`dexie` and, for the tests, `fake-indexeddb` are already dependencies of `apps/web` (ADR-0012), added by the lead.
The import flow also waits for the platform directory operations of #202.
