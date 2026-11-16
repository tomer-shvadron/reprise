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
  through the audio package's `resolveEffects`: the family's preset, or "Automatic (off on the GM
  tier)" while the GM tier bypass is on. A choice is one undoable `setTrackProperties` with
  `sound: { ...sound, preset }`; Automatic drops `preset` (the command cannot clear `sound`, so it
  stays as `{}`, which means the same as none). The engine applies a preset-only change at once,
  with no rebuild, and an id it does not know plays, and shows, as Automatic. The mixer strip
  mounts it (`features/tracks`).
- `EffectsDemo`, under the placeholder on the Sounds screen, lists each track with its picker and a
  toggle per stage (input, drive, tone, cabinet, modulation, delay, output, reverb) that calls the
  engine's `setStageBypass` through `audio.debug().engine`. Stage bypass is session state: not
  saved, cleared when the song unloads, and kept out of the mixer by the v1 scope
  ("per-track effects editing beyond preset choice" is out).
- The GM tier bypass switch is in the mixer's master strip (`features/tracks`).
