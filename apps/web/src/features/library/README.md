# Library

**Owner**: the formats lane (`[P:formats]`). **Filled by**: WP-060 (library and import), WP-061
(save, export and autosave), and the schema migration of WP-073 (practice log).

WP-060 lands in two PRs. The first, below, is the database, the library screen and opening a song;
the second adds the import flow (pickers, batch with progress and cancel, trash, recents, the
open-without-import banner and the shell wiring), which waits for the platform file operations of #202.

| Export                           | What it is                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `LibraryScreen`                  | The song list with search, sort and open. The app shows it over the score while `ui.screen` is `'library'`. |
| `libraryOf(services)`            | The one `Library` of an app instance (database, store, session keeper), kept in a `WeakMap`.                |
| `libraryCommands` (`./commands`) | `library.show` ("Show library"), which sets the screen. WP-060 adds open-without-import and the recents.    |

## How it works

- **Database** (`db/`). Dexie over IndexedDB, in the browser and in Electron alike. `schema.ts` holds
  `SCHEMA`, an **append-only** list of versions: a shipped version is never edited, because a user's
  database may be at any of them. WP-073 appends version 2 (`practiceSessions`) there and extends the
  harness in `db/schema.test.ts`, which reopens a database written at every earlier version and
  asserts that no row is lost and every table exists. Rows (`rows.ts`) are Zod schemas, and the repository
  `safeParse`s on read: a bad row is skipped and logged, never thrown. `lastOpenedAt` is left out
  until a song is first opened, so the recents index only holds opened songs.
- **List** (`search.ts`, `song-list.tsx`). The store keeps every row in memory with a folded haystack
  (title, artist, album, accents and case removed); filter and sort are pure functions over it, so a
  keystroke never waits on IndexedDB. The list mounts only the rows in view (fixed row height, no
  dependency) and is one listbox that keeps focus, naming the active row with `aria-activedescendant`.
  The sort is saved in `settings` as `library.sort`.
- **Opening** (`library.ts`). `openSong` reads the native from `row.nativePath`, opens it with that path
  as the handle (so Save writes it in place) and the row id as `songId`, then, only if the document is
  still that song's, restores the stored track session (`restoreTrackSession` never moves `dirty` or
  the history) and starts the session keeper.
- **Session keeper** (`session-keeper.ts`). Started after the restore, so the restore is not written
  back; debounces writes to the song's row by 500 ms; flushes and stops when the document switches;
  ignores a document that is not its song's.
- **Parsing** (`import/`). `parseImport` is the pure detect, read, native write, summarize and hash
  step. `createParser` runs it in a module Worker (`parse.worker.ts`) with the bytes transferred both
  ways, and inline where there is no `Worker` (jsdom). Readers mint fresh ids on every read, so a song
  must never be written from one read and opened from another: the native stored with a song is the
  one whose ids its track session names.

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
