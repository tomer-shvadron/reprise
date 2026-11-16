# Sounds

**Owner**: the audio lane (`[P:audio]`). **Filled by**: WP-091 (sound pack manager) and WP-094
(memory UI and tuning). The engine work of WP-090, WP-092 and WP-093 lands in `packages/audio`.

Today it holds only the entry points the lead stubbed in WP-056:

| Export                          | What it is                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------- |
| `SoundManager`                  | A placeholder naming WP-091. The app shows it over the score while `ui.screen` is `'sounds'`. |
| `soundsCommands` (`./commands`) | `sounds.show` ("Show sound manager"), which sets the screen.                                  |
| `TrackEffectsPicker`            | `({ trackId, label? })`: a select of the track's effects preset (WP-092), see below.          |

## What it can rely on

- `ui.screen` and `ui.setScreen`: the sound manager is a full-window screen.
- `document.songId`: the library song a pack assignment attaches to (ADR-0012); WP-091 stores it per song.
- `playback.memory` mirrors the engine's memory report, for the readout of WP-094.
- `platform().dataDir()` for `sounds/<id>/`.

Per-track sound assignment shows in the mixer (`features/tracks`, the lead's); WP-091 adds the
control through a small export that the lead wires, not by editing the mixer. Needing a shared
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

- `AppServices.sounds` is the `SoundPackStore` from `createSoundPackStore({ platform })`: the minimal
  shape, `getState().installed`, `get(id)`, `setInstalled(packs)` and `subscribe(listener)`. It is the
  `PackDirectory` the audio service reads; WP-091 adds the scan of `data/sounds`, the installer and
  the actions. `InstalledPackSource` and `PackDirectory` are in `state/sound-packs.ts`.
- `playback.trackSounds[trackId]` is `{ tier, packId?, problem?: 'missing' | 'failed', message? }`:
  `missing` is a pack (or instrument) the directory lacks, `failed` one the engine could not load.
  Both play GM.
- `audio.releasePack(id)` reloads without the pack and resolves once the engine holds no reader for
  it; call it before deleting the folder.
- The drop zone ignores drops while `ui.screen` is `'sounds'`: the screen takes a dropped zip.
