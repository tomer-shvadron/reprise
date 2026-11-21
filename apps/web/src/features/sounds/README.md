# Sounds

**Owner**: the audio lane (`[P:audio]`). **Filled by**: WP-091 (sound pack manager) and WP-094
(memory UI and tuning). The engine work of WP-090, WP-092 and WP-093 lands in `packages/audio`.

Today it holds only the entry points the lead stubbed in WP-056:

| Export                          | What it is                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `SoundManager`                  | The Sounds sheet (WP-091): packs, curated list, installs, remove. Shown while `ui.sheet` is `'sounds'`. |
| `soundsCommands` (`./commands`) | `sounds.show` ("Show sound manager"), which opens the sheet.                                            |
| `instrumentLabel`               | `(instrumentId, packs)`: the name of a resident instrument, see "Memory" below.                         |
| `TrackEffectsPicker`            | `({ trackId, label? })`: a select of the track's effects preset (WP-092), see below.                    |
| `TrackSoundPicker`              | `({ trackId, label?, generalMidi? })`: a select of the track's sound pack (WP-091), see below.          |

## What it can rely on

- `ui.sheet`, `ui.showSheet` and `ui.closeSheet`: the sound manager is a modal sheet over the player.
- `document.songId`: the library song a pack assignment attaches to (ADR-0012); WP-091 stores it per song.
- `playback.memory` mirrors the engine's memory report; the memory panel reads it.
- `platform().dataDir()` for `sounds/<id>/`.

Per-track sound assignment shows in the mixer (`features/tracks`, the lead's): `TrackSoundPicker`
is the "Sound" row of each strip, wired by the integration commit of WP-091 PR C. Needing a shared
store field is a `type:contract` issue for the lead.

## Effects presets (WP-092)

The chain, the presets and their ids live in `packages/audio` (its README has the signal path). This
folder holds the UI:

- `TrackEffectsPicker` is a compact select: "Automatic (<family>)", the family presets, Fuzz and
  Off. Automatic shows what it resolves to, from the track's program and `settings.gmTierBypass`
  through the audio package's `resolveEffects`: the family's preset, or "Automatic (off on GM
  sounds)" while the GM tier bypass is on. A choice is one undoable `setTrackProperties` with
  `sound: { ...sound, preset }`; Automatic drops `preset`, and `sound` itself once nothing is
  left (`null` removes it), so the gp writer reports no `sound-override` loss for the track. The engine applies a preset-only change at once,
  with no rebuild, and an id it does not know plays, and shows, as Automatic. The mixer strip
  mounts it (`features/tracks`).
- `EffectsDemo`, under the placeholder on the Sounds screen, lists each track with its picker and a
  toggle per stage (input, drive, tone, cabinet, modulation, delay, output, reverb) that calls the
  `audio.setStageBypass`. The demo restores what it bypassed when it closes or the document changes. Stage bypass is session state: not
  saved, cleared when the song unloads, and kept out of the mixer by the v1 scope
  ("per-track effects editing beyond preset choice" is out).
- The GM tier bypass switch ("No automatic effects on GM sounds", with a note that a track's own
  preset still applies) is in the mixer's master strip (`features/tracks`).
- The label reads the track's tier from `playback.trackSounds`, which the audio service derives with
  the audio package's `tierOf` (#267); a track with no entry is GM.

## Pack contract (#267)

- `AppServices.sounds` is the `SoundPackStore` from `createSoundPackStore({ platform, audio })`. It is
  the `PackDirectory` the audio service reads (`get(id)`, `subscribe(listener)`, which fires only when
  the installed set changes, never on install progress) and a zustand store (`api`, for `useStore`)
  with the actions of the pack manager, below. `InstalledPackSource` and `PackDirectory` are in
  `state/sound-packs.ts`.
- `playback.trackSounds[trackId]` is `{ tier, packId?, source?: 'default', problem?: 'missing' | 'failed', message? }`:
  `missing` is a pack (or instrument) the directory lacks, `failed` one the engine could not load.
  Both play GM.
- `audio.releasePack(id)` reloads without the pack and resolves once the engine holds no reader for
  it; call it before deleting the folder.
- The drop zone ignores drops while `ui.sheet` is `'sounds'`: the sheet takes a dropped zip.

## Pack manager (WP-091, [ADR-0028](../../../../../docs/decisions/0028-sound-packs-stored-under-data-sounds-and-a-curated-list-of-confirmed-licences.md))

- `manifest.ts`: the zod schemas (`PackManifest`, `InstalledPack`) and the `data/sounds/<id>/` layout:
  `pack.json` and `files/`. A `Track.sound.packId` is the 12-character pack id.
- `curated-packs.ts`: the list the screen offers, only packs whose licence was confirmed on the source
  page, with the pinned SHA-256 and size of each direct download. `docs/reference/sound-packs.md` is
  the record, and a test keeps the two in step.
- `curated-instruments.ts`: `reconcileCurated`, run by the scan, gives a same-version installed curated
  pack the list's instruments (so new `entries`, like Growlybass's staccato file, need no
  re-download) and drops what the copy's file index lacks. `install/install.ts` groups a custom
  pack's `guitar.sfz` + `guitar_pm.sfz` files into one instrument with `palmMute` (WP-093).
- `install/zip.ts`: the zip reader for untrusted archives (ranged reads, `DecompressionStream`,
  caps on entries, depth and sizes, no traversal, symlinks, encryption or overlap).
- `install/install.ts`: `installPack` stages, checks (`checkSfzFile`, `checkPack`) and swaps a pack in;
  `downloadPackArchive` goes through `Platform.download`; `sweepWorkAreas` clears leftovers.
- `pack-store.ts`: the scan (startup, from `App`), `installCurated`, `installZip`, `installFolder`,
  `cancel`, `remove` (releases the pack from the engine first, reinstates it if the folder cannot be
  removed), `removeDamaged` and `rename`. One install runs at a time.
- `pack-files.ts`: the reader the engine gets for a pack: a path is looked up in the pack's own file
  index (exactly, then ignoring case) and never reaches the platform otherwise.

## Sounds screen (WP-091)

Each pack row has a context menu (`menus.ts`, `commands.ts`: Rename, Update, Download, Open download page, Remove); the Remove confirm and the rename form are opened through `removingId` and `renamingId` in the pack store.

`SoundManager` lists installed packs by family (licence link, size, version, tracks of the open song
that use it, Update when the list has a newer version, Rename for custom packs, Remove behind a
confirm that says how many tracks fall back to General MIDI), the curated packs not yet installed
(Download where `Platform.download` exists; else "Open download page" and "Choose zip"), damaged
folders with Remove, and every refusal with its details. One install runs at a time, with progress
and Cancel. "Install from zip" and "Install from folder" add a custom pack. A zip or folder dropped
anywhere on the screen installs as a custom pack, and a zip dropped on a curated row installs that
pack (`drop.ts`; the drop zone leaves drops to this screen). The memory panel is at the top
(below); the effects demo stays below the lists.

## Sound picker (WP-091 PR C)

`TrackSoundPicker` is a compact select in the mixer strip, under "Instrument":

- The first option is "Default (<what the family default plays now>)", value `''`, which stores nothing:
  the pack instrument's name, or "General MIDI (<program name>)" when the family is GM or its pack is
  missing, so the select shows what actually plays. The second is "General MIDI (<program name>)",
  which stores `sound.generalMidi: true` (the mixer supplies the name). Installed packs
  follow, "Suggested" first (a pack whose `gmPrograms` include the track's program, or a drum pack on
  a drum track), then "Other packs". A pack with several instruments has one option each
  ("Black and Blue Basses: Blue"); a single-instrument pack has one.
- A choice is one undoable `setTrackProperties` with `sound: { ...sound, packId, instrument? }`.
  `instrument` is stored only for a multi-instrument pack (absent means the pack's first). Every
  choice clears `packId`, `instrument` and `generalMidi` before setting its own, and drops `sound` with `null` once nothing is left, so the
  effects preset survives and the gp writer reports no `sound-override` loss.
- A `packId` (or instrument) the directory lacks stays selected as "<name or id> (not installed)",
  with "<name> is not installed: playing General MIDI" under the select. The score is never edited:
  reinstalling the pack brings the sound back. A pack the engine could not load shows
  `trackSounds[id].message` the same way.
- The audio service turns the score and the pack directory into the engine's assignments and mirrors
  `playback.trackSounds` (tier, `missing`, `failed`); the effects label reads the tier from it, so an
  HQ bass track shows "Automatic (Bass)" with the GM tier bypass on.
- The acceptance test, `sound-packs.browser.test.tsx`, installs a synthetic pack zip through the pack
  store, picks it in the mixer, renders offline and compares with the GM render; it then removes the
  pack and the render matches GM again with `trackSounds` marked `missing` and no error.

## Memory (WP-094)

`MemoryPanel`, at the top of the Sounds screen (`data-slot="memory-readout"`), reads `playback.memory`
and `playback.settings.memoryBudgetBytes`:

- A meter (`role="meter"`, in MB, with `aria-valuetext` "X MB of Y MB") and the same text beside it.
- "Memory for sounds": a select of 64, 128, 200, 300 (the default), 500, 750, 1000, 1500 and 2000 MB
  (MiB, as the status bar counts) that calls `audio.setMemoryBudget`. A stored value that is not a
  preset is added to the list, so the select never shows a figure the setting does not hold.
  Lowering it evicts at once; raising it re-warms the open song.
- The instruments held in memory, sorted by name, behind "Show all N" past eight. "No sounds loaded"
  when there are none.
- "Unload unused", disabled and reading "Nothing unused" while `memory.unused` is empty; otherwise it
  calls `audio.unloadUnused()` and announces "Freed N instruments" (the engine returns a count).
- While `memory.shortfall` is true, the note "This song needs more than the budget; some notes may
  start late."
- `instrumentLabel(id, packs)` (`memory-labels.ts`): `gm:<bank>:<program>` reads "General MIDI:
  Overdriven Guitar" (with " (bank N)" when the bank is not 0), `gm:drums:<kit>` "General MIDI:
  Standard Kit". A pack resident, `sfz:<packId>@<install>:<sfzPath>`, is mapped back through the
  entries of the installed pack: "Pack name: Instrument", "Pack name" for a single-instrument pack,
  " (set)" after a non-default articulation set, "Pack name: path" when no instrument holds the
  path, "<packId> (removed)" when the pack is gone. Any other id comes back unchanged.
- The acceptance test, `memory-panel.browser.test.tsx`, installs a synthetic pack of about 67 MiB
  decoded, picks it for a bass track, chooses 64 MB (the panel shows at most 64 MB and the shortfall
  note, and `decodedBytes` agrees), then 300 MB again: after `settled()` the figure is back and the
  note is gone.

## Default sounds

A track that chose no sound plays its family's default (#346). `soundFamilyOf(track)` gives the family (drums by kind, then GM programs 0-23 keys, 24-25 acoustic guitar, 26-31 electric guitar, 32-39 bass, 40-79 orchestral, else other), and `DEFAULT_SOUND_SETTINGS` holds one handle per family, `sounds.default.<family>`: `'gm'`, or a pack and optional instrument. Both guitar families default to Karoryfer Emilyguitar "Five voices" (`EMILYGUITAR_FIVE_VOICES`), the rest to General MIDI.

- `createDefaultSounds(settings)` is the `DefaultSounds` source the audio service reads (`state/sound-packs.ts`); it notifies on any handle, and the service reloads the song.
- Precedence, in `app/audio/track-sound.ts` (`resolveTrackSound`): a pack the track names, an explicit `sound.generalMidi`, the family default, the track's GM program. The file's program only picks the family; it is never a choice.
- A default applies at play time only. It is never written into the score, the `.reprise` file or a gp export.
- A default whose pack is not installed (or lacks the instrument) plays GM with no warning: the track's `trackSounds` entry is `{ tier: 'gm', packId, problem: 'missing', source: 'default' }`, which the mixer's notice ignores and the download offer reads.
- All guitar tracks share one resident instrument, so memory does not grow with the track count (`hq-memory-budget.test.ts`).
- `sounds.offeredPacks` records which curated packs the one-time download offer has shown.
- UI: the Settings "Sounds" section (`sounds-section.tsx`, one select per family, Download or Open Sounds beside a pack that is not installed); `DefaultSoundOffer` (`default-sound-offer.tsx`, mounted in `app/notices.tsx`) shows once per pack id when the open song has a track defaulting to a missing curated pack, with Download on desktop and Open Sounds on the web; the Sounds sheet counts tracks that play a pack as the default too.
