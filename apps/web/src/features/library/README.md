# Library

**Owner**: the formats lane (`[P:formats]`). **Filled by**: WP-060 (library and import), WP-061
(save, export and autosave), and the schema migration of WP-073 (practice log).

WP-060 landed in two PRs: the database, the library screen and opening a song, then the import
flow (pickers, batch with progress and cancel, trash, recents, the open-without-import banner and the
shell wiring, which is one separate integration commit).

| Export                            | What it is                                                                                                        |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `LibraryScreen`                   | The song list with search, sort and open. The app shows it over the score while `ui.screen` is `'library'`.       |
| `libraryOf(services)`             | The one `Library` of an app instance (database, store, session keeper), kept in a `WeakMap`.                      |
| `libraryCommands` (`./commands`)  | `library.show`, `library.importFiles`, `library.importFolder`, `library.openWithoutImport`, `library.openRecent`. |
| `installLibrary(services)`        | Loads the library and keeps the desktop File menu's Open Recent in step (`setRecentSongs`, `onOpenRecent`).       |
| `RecentSongs`, `UnimportedBanner` | The empty state's recent list, and the "Not in your library" banner with its Import button.                       |
| `snapshotDrop`                    | Takes a drop's files and folders synchronously, for the drop zone to hand to `importDrop`.                        |

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
- **Paths** (`paths.ts`). `nativePath` and `originalPath` are root-relative
  (`library/songs/<id>.reprise`) and stored in the row, so the spelling is part of the persisted schema:
  changing it takes a schema version with an `upgrade`. `nativePath` is also the document's save
  handle. Reading and writing them relies on the platform contract of #202 (PR #207): `readFile`,
  `writeFile` and a string `writeHandle` accept root-relative storage paths there.
- **Batch import** (`import/importer.ts`). Sources (`{ name, size, read() }`, from a picker, a picked
  folder or a drop) are read one at a time, the next while the current one parses; the bytes are parsed
  in the worker, skipped when their SHA-256 (`originalKey`) is already indexed, else the native and the
  original are written (`files.ts`) and the row added; a failed step removes what it wrote. Progress,
  cancel (after the file in flight) and the summary live in `library.importer.store`. Sources given
  while a batch runs join it. Names that are not score files are skipped by extension, not failed.
- **Open and import** (`library.openAndImport`). A single file (drop, `file.open`) opens through
  `openBytes` exactly as before, with a fresh `songId`; the duplicate lookup runs beside the open, so
  drop-to-paint does not wait on the database. Then the native is written **from the open score**
  (`parser.native`, in the worker), never from a second read, so track ids match; the original and the
  row follow, and the session keeper starts. A duplicate opens the library's song instead. A failed
  write clears `songId`, keeps the file open and shows the banner. `openWithoutImport` keeps the bytes
  in memory so the banner's Import (`importOpenDocument`) can still copy the original. The banner
  follows the library's own `unimportedId`, the document id those bytes belong to, so a new song
  (`document.newDocument`), a new song saved with Save As and a song deleted from the library never
  show it. The held bytes are released, and `bannerError` cleared, whenever the document id changes.
- **Delete** (`library.deleteSong`). The song's native and original folder move to
  `library/trash/<id>/` beside a `song.json` copy of the row; then the row goes. An open song becomes
  unimported (`songId` cleared); its document still carries the save handle it was opened with, which
  WP-061's Save must not follow without a `songId`.
- **Recents.** The 5 most recently opened songs (`RecentSongs`), the palette command
  `library.openRecent` (the library sorted by last opened), and on desktop the File menu through
  `setRecentSongs` (at most 10), with `onOpenRecent` opening the pick.
- **Closing the window.** Nothing calls `Library.dispose()`; the session keeper flushes on `pagehide`
  and on `visibilitychange` to hidden, so the last 500 ms of changes are kept without shell wiring. An import running when the window closes is not awaited (no close hook can wait on a promise), so the worst case is files in the library folder with no row; files are written before the row. `dispose()` itself awaits the library's in-flight imports before closing the database.
- **Parsing** (`import/`). `parseImport` is the pure detect, read, native write, summarize and hash
  step. `createParser` runs it in a module Worker (`parse.worker.ts`) with the bytes transferred both
  ways, and inline where there is no `Worker` (jsdom). Readers mint fresh ids on every read, so a song
  must never be written from one read and opened from another: the native stored with a song is the
  one whose ids its track session names.

## What it can rely on

- `document.songId`: the song a document was opened from, passed as `songId` in the options of
  `openBytes(name, bytes, { handle?, songId? })` and set later with `setSongId` after importing a file opened without import. Cleared by
  `close`, `newDocument` and the next open.
- `ui.screen` and `ui.setScreen`: the library is a full-window screen; leaving it sets `'player'`.
- `captureTrackSession`, `restoreTrackSession` and `watchTrackSession` from `features/tracks` for the
  per-song settings.
- The practice session shape (`state/practice.ts`) for the `practiceSessions` table of WP-073.

The Dexie schema file lives here and is owned by this lane, so WP-073 adds its table by migration
there. Needing another field on a shared store is a `type:contract` issue for the lead, not an edit.

`dexie` and, for the tests, `fake-indexeddb` are already dependencies of `apps/web` (ADR-0012), added by the lead.
