# Tracks

The track list in the left sidebar and the mixer in the right panel (WP-052, ADR-0024). It owns no
store: every control writes the document, selection or playback store through the actions in
`track-actions.ts`, which the commands in `commands.ts` call too.

| Export                                                            | What it is                                                                                                                    |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `TrackSidebar`                                                    | Each track's colour, name, instrument, visibility, mute, solo, notation and compact volume; the multitrack toggle.            |
| `MixerPanel`                                                      | Per track: instrument, volume, pan, mute and solo, with the load status of a new instrument; the master volume.               |
| `captureTrackSession`, `restoreTrackSession`, `watchTrackSession` | The per-song session the library keeps (WP-060): visibility, single-track view, mute and solo, current track; never notation. |
| `trackCommands` (`./commands`)                                    | Previous and next track (⌘↑ ⌘↓), multitrack view (F3), mute, solo, clear, show all, and notation for the current track.       |

## Where each value lives

| Value                         | State                                           | Undo | Modified | Saved in the file             |
| ----------------------------- | ----------------------------------------------- | ---- | -------- | ----------------------------- |
| Volume, pan, instrument       | the score, through `setTrackProperties`         | yes  | yes      | yes                           |
| Notation per track            | `document.view.notation`                        | no   | yes      | yes, folded in on Save        |
| Visibility, single-track view | `document.view.tracks`, `view.only`             | no   | no       | no (library, WP-060)          |
| Mute, solo                    | `playback.mixer`, the audio service's overrides | no   | no       | the file's own flags, as read |
| Current track                 | `selection.currentTrack`                        | no   | no       | no (library, WP-060)          |
| Master volume                 | `settings.masterVolume` (WP-051)                | no   | no       | no (a preference)             |

## Decisions

- **A slider previews while dragging and commits once.** `onValueChange` calls
  `audio.previewTrack`, which moves the strip only; `onValueCommit` applies one command. A drag is
  one undo step and one layout run; each keyboard step is one of each.
- **No rebuild for a mixer edit.** The audio service applies an edit that touches only track
  properties the timeline never reads (`app/audio/timeline-neutral.ts`) to the strips and
  instruments directly, so a change and its undo are heard at once during playback. A new
  instrument decodes its samples with progress in `playback.instrumentLoads`.
- **Rows take primitives.** The list computes each row's mute, solo and audibility, so a frame
  of playback position re-renders no row, and a volume edit re-renders one.
- **Hidden tracks still sound.** Visibility is display only, as in Guitar Pro.
- **Instrument names are the GM tables in `gm-programs.ts`**, not the sound bank's preset names,
  so the picker works before the bank loads.
