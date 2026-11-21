# Library

**Owner**: the formats lane (`[P:formats]`). **Filled by**: WP-060 (library and import), WP-061
(save, export and autosave), and the schema migration of WP-073 (practice log).

WP-060 landed in two PRs: the database, the library screen and opening a song, then the import
flow (pickers, batch with progress and cancel, trash, recents, the open-without-import banner and the
shell wiring, which is one separate integration commit).

| Export                            | What it is                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `LibraryScreen`                   | The song list with search, sort and open. The app shows it as a sheet over the player while `ui.sheet` is `'library'`. |
| `libraryOf(services)`             | The one `Library` of an app instance (database, store, session keeper), kept in a `WeakMap`.                           |
| `libraryCommands` (`./commands`)  | `library.show`, `library.importFiles`, `library.importFolder`, `library.openWithoutImport`, `library.openRecent`.      |
| `installLibrary(services)`        | Loads the library and keeps the desktop File menu's Open Recent in step (`setRecentSongs`, `onOpenRecent`).            |
| `RecentSongs`, `UnimportedBanner` | The empty state's recent list, and the "Not in your library" banner with its Import button.                            |
| `snapshotDrop`                    | Takes a drop's files and folders synchronously, for the drop zone to hand to `importDrop`.                             |

## How it works

- **Database** (`db/`). Dexie over IndexedDB, in the browser and in Electron alike. `schema.ts` holds
  `SCHEMA`, an **append-only** list of versions: a shipped version is never edited, because a user's
  database may be at any of them. Version 2 (`practiceSessions`, WP-073: the practice log's table, owned by `features/trainer`) is
  appended there and extends the harness in `db/schema.test.ts`, which reopens a database written at every earlier version and
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
- **Delete** (`Library.deleteSong(id)`; the row's Delete button, the Delete key and the row menu's "Delete from library…", the command `library.deleteSong`, only set `deleteId` in the store, which opens the confirm; so does `practiceLogId` for the practice log). The song's native and original folder move to
  `library/trash/<id>/` beside a `song.json` copy of the row; then the row goes. An open song becomes
  unimported (`songId` cleared); its document still carries the save handle it was opened with, which
  Save does not follow without a `songId`: the saver and the built-in `save()` both treat a `library/`
  handle with no song as no handle at all.
- **Save** (`save/save-flow.ts`, installed with `document.setSaver` by `installLibrary`). In order:
  a document with a `songId` whose row exists writes `.reprise` to `row.nativePath` (never the
  original file, even a `.gp`) and updates the row's summary and `savedAt`; a file opened without
  importing and with a writable handle in `.reprise` or `.gp` goes to the built-in in-place save,
  keeping the Guitar Pro loss prompt; a document with no file at all (a new song) joins the
  library on its first Save (a new `songId`, `library/songs/<id>.reprise`, a row with no
  `originalPath`, `originalKey` the hash of the first saved bytes); anything else (a gp3, gp4,
  gp5 or gpx file opened without importing, a deleted song) shows a short notice through
  `store.notice` and goes to Save As. Save As is the built-in: `.reprise` anywhere, and the
  document leaves its song. A Save while the song's row is not there yet (the import of a file
  just opened runs in the background) waits for the library's imports before choosing.
- **Export and copy as ASCII tab** (`save/ascii-export.ts`, `ascii-export-dialog.tsx`, `ascii-scope.ts`, `library.asciiExport`; #350). `file.exportAsciiTab` opens a modal with the tracks (drum and pitched ones greyed out with the reason), the bars (whole song, or the selected ones) and the line width (remembered for the session), and writes a `.txt` through `platform.saveFile`. `edit.copyAsciiTab` needs no dialog: it takes the context menu's bar, or the selection's range (its tracks and bars) or bars (the current track), and writes the system clipboard through `lib/system-clipboard.ts`. Neither is a save. Both end with a notice that lists what the text leaves out; there is no confirmation. In the desktop app the copy needs the `clipboard-sanitized-write` grant in `apps/desktop/src/main/permission.ts`, which `pnpm desktop:smoke` does not cover.
- **Export and copy as image** (`library.imageExport`, built here from `createImageExporter` in `features/score/image/`, because notices live in this store; #351). `file.exportImage` opens the score feature's dialog and `edit.copyImage` copies the selection as a 2x PNG on white; both sit in `commands.ts` and `menus.ts` (File > Export, the `score.range` and `score.bar` menus). The selection comes from `imageScopeOf` (`save/ascii-scope.ts`): the bars as for ASCII tab, the tracks of an edit range, else the tracks on screen. The write tracking `settleLibraryWrites` reads is in `library-writes.ts`, a leaf module, because `test/setup.ts` imports it and anything it imported would be cached before a test's `vi.mock`.
- **Export as Guitar Pro** (`save/export-flow.ts`, `export-dialog.tsx`, `library.exportGuitarPro`).
  Writes `write(score, 'gp')` of the score as shown through `platform.saveFile`, and changes
  neither `dirty`, the file, its handle nor `songId`. The dialog lists only what the writer drops,
  not what the import dropped; a library song has a "Don't warn again for this song" box that stores
  the accepted `Warning.code`s on the row (`exportAcknowledged`), and a later export asks again only
  for a code not in the list. A document outside the library has no box.
- **Drafts** (`drafts/`, started by `installLibrary`). While the document is modified the keeper
  writes `data/drafts/<key>.reprise` and a `<key>.json` sidecar (`{ version, key, songId?, name,
title, updatedAt }`, bytes first), 1 s after the last edit and at least every 10 s while edits
  continue, serialized in the parse worker when the main thread is idle. The key is the `songId`,
  else `doc-<document.id>`. The draft is removed when the document becomes clean (a save, or undo
  to the saved point), is replaced or is closed (every replace path asks first), and when its
  song is deleted. A write that has not started is dropped if the document changed meanwhile, and
  the old key goes when a song id arrives while the edits stay unsaved. Writes and removals run
  one at a time. A write records its key before any bytes go out, so a removal that comes during it
  deletes what it writes; serialization is not queued, so a hung worker never delays a removal, and
  a worker that fails or hangs is replaced once before autosave reports "Autosave is off". A save
  that ends with the document still modified is followed by a fresh draft, and `savedAt` is the
  time the save began, so a draft whose content was captured after that (an edit made during the save) is newer; a draft's `updatedAt` is when its content was captured, not when it landed.
  The keeper flushes on `pagehide` and `visibilitychange`, best effort: the idle wait is skipped,
  but a worker round trip and a file write cannot finish once a page is being torn down, so on the
  web the last second of edits, or all of a first edit, can be missing after Leave. The
  `beforeunload` prompt while modified is the protection there.
  - **Cost.** The 13 ms measured by `drafts/draft-cost.browser.test.ts` for the 8 x 300 reference
    score (about 29.5 MB of native) is the structured clone of the score into the worker only. The
    main thread also pays for the 29.5 MB result cloned back and, on desktop, for serializing
    those bytes for `ipcRenderer.invoke` to main (which then does an fsync and a rename per
    draft). Levers if that shows up in practice: a longer debounce for large natives, or
    transferring the result buffer. Over about 50 ms the next step is a worker that mirrors the score by
    replaying `Change.patches`, which needs a model contract.
  - **Recovery** (`drafts/recovery.ts`, `DraftRecoveryDialog`). After `load()` (and only when it
    succeeded, or every draft would look orphaned) the folder is listed. A draft of a song is
    offered when `updatedAt` is newer than the row's `savedAt` (else `importedAt`); a draft whose
    song is gone or already saved past it, and a sidecar without bytes, are removed; a `doc-` draft
    is always offered. Bytes whose sidecar is missing or unreadable are offered as an untitled
    recovery and never removed unasked. Recover opens a song's draft with `modified: true`
    and restores its session; a `doc-` draft becomes an untitled modified document whose first
    Save joins the library. The recovered document is written under its own key at once, and only
    then are the old files removed. Later (and Escape) keeps the drafts for the next launch; opening a song that has one waiting shows the dialog again, and the keeper never overwrites a draft that is still waiting: edits go under `doc-<document.id>` (no song named) meanwhile, so autosave never stops, and recovery offers both. Undo
    history is not recovered.
  - **Known limit.** Two web tabs editing the same song write one draft key; the last writer wins.
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
- `ui.sheet`, `ui.showSheet` and `ui.closeSheet`: the library is a modal sheet over the player; leaving it closes the sheet.
- `captureTrackSession`, `restoreTrackSession` and `watchTrackSession` from `features/tracks` for the
  per-song settings.
- The practice session shape (`state/practice.ts`) for the `practiceSessions` table of WP-073.

The Dexie schema file lives here and is owned by this lane, so WP-073 adds its table by migration
there. Needing another field on a shared store is a `type:contract` issue for the lead, not an edit.

`dexie` and, for the tests, `fake-indexeddb` are already dependencies of `apps/web` (ADR-0012), added by the lead.

`rankSongs` (`song-search.ts`) ranks the library's rows for the command palette's `/` mode: title prefixes first, capped at 50 with the total, over `filterEntries` so accents fold as in the library's own search. `requestOpenSong(id, { report: 'notice' })` shows a failed open as a notice, for an entry that is not the library screen.
