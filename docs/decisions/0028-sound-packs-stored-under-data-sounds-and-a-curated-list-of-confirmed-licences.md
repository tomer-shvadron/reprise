# ADR-0028: Sound packs live in `data/sounds/<id>/`, and the curated list holds only confirmed licences

- **Status**: Accepted
- **Date**: 2026-11-16
- **Deciders**: the lead's decisions on #195 (3, 4, 5, 8, 9, 11), which the owner can overrule

## Context

WP-091 (#195) installs HQ sound packs: SFZ instruments that a track can use in place of the General
MIDI soundfont. A pack is hundreds of megabytes, comes from a third party, and is either dropped
by the user (a zip or a folder) or downloaded. Songs name a pack by `Track.sound.packId`, which is a
12-character id (#243), so the id must outlive a reinstall. The ranged reads and the desktop
download of #266 are the platform's side of it.

## Decision

**Layout.** A pack is `data/sounds/<id>/pack.json` plus `data/sounds/<id>/files/<pack paths>`.
`pack.json` is the manifest (name, family, GM programs, licence, version, instruments with their
SFZ entries) and the install record (`curated`, `source`, `installedAt`, and every file's path and
size). `files/` keeps a pack's own file from colliding with `pack.json`. The scan skips dot folders
(`.staging`, `.trash`, `.downloads`), which are work areas swept at startup. A folder whose
`pack.json` is missing, invalid or names another id is listed as damaged, with a Remove action.

**Ids.** A curated pack has a fixed generated id, written in the list and never derived, so a song
finds the pack again after the user removes and reinstalls it. A custom pack gets `newId()`.

**Installing.**

- The zip is read in the renderer by our own reader (`features/sounds/install/zip.ts`): ranged
  reads of the central directory, `DecompressionStream('deflate-raw')` per entry, no dependency.
  The archive is untrusted input. The reader caps the entry count, the path depth and every size,
  and refuses `..`, absolute, drive and UNC paths (backslashes count as separators), symlinks,
  encryption, other compression methods, duplicate names including case-only ones, overlapping
  entries, local headers that disagree with the directory, and a bad CRC. An entry that inflates
  past its declared size is stopped at that size.
- Files are staged under `data/sounds/.staging/<id>-<hex>/`, checked with the audio package's
  `checkSfzFile` / `checkPack`, and moved into place with one `move`. An update first moves the old
  folder to `.trash/`, and puts it back if the swap fails. A refused or cancelled install leaves
  nothing under `data/sounds` but the swept work areas.
- Only the copy list is written: `.sfz`, `.sfzh`, `.inc`, `.wav`, `.flac`, `.ogg`, `.oga`, `.opus`,
  `.txt`, `.md` and `LICENSE`/`README` files. A name the platform's storage rules refuse is refused
  with its name, never renamed, because the pack's own files refer to it.
- A curated pack is verified by its contents (every manifest entry present and passing), not by
  the archive hash, so a zip the user downloaded themselves, even a newer release, installs when it
  has the same entries. A custom pack's instruments are the root-level `.sfz` files that pass.
- The pack's file index is what the audio engine reads through: a path outside it never reaches
  the platform, and a sample named in another case resolves through it.

**Downloading.** Only on desktop, through Electron main (`Platform.download`, #266). The renderer
never fetches a pack. The browser build offers "Open download page" and the zip drop.

**Removing.** The engine releases the pack first (`AudioService.releasePack`), then the folder is
removed, and the pack is reinstated if that fails. The score is never edited: `sound.packId`
stays, the tracks play General MIDI and the mixer says the pack is not installed. Reinstalling the
same curated pack brings the sound back.

**The curated list** holds only packs whose licence was confirmed on the pack's own source page
(date and page in `docs/reference/sound-packs.md`). `directDownload: true` needs all of an open
licence (CC0, CC BY, an open source licence), a stable archive URL, and a SHA-256 and size
measured from one real download. Every other pack is drop-only, with an "Open download page"
link. A pack whose terms cannot be confirmed is left out and named in the reference.
Impulse-response downloads are out of scope.

## Consequences

- No zip dependency, and one extraction path for desktop, the browser build and the tests. The
  cost is a reader we maintain and test against hostile archives.
- Installing a gigabyte pack writes every file through IPC; progress and Cancel are in the UI.
  There is no free-space check: a full disk fails a write and the staging folder is removed.
- A pack changed outside the app while a song plays makes fetches reject (the notes are skipped);
  the next scan or load reports it.
- The installed-size cap for a curated pack (1.25 times the list's `sizeBytes`) and the hash of
  its archive are the list's to keep in step with each release: a version bump re-measures both.
