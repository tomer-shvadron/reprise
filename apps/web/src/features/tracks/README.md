# Tracks

The track list in the left sidebar and the mixer in the right panel (WP-052, ADR-0024). It owns no
store: every control writes the document, selection or playback store through the actions in
`track-actions.ts`, which the commands in `commands.ts` call too. The one exception is the Effects
row, `TrackEffectsPicker` from `features/sounds`, which applies its own command.

| Export                                                            | What it is                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TrackSidebar`                                                    | Each track's colour, name, instrument, visibility, mute, solo, notation and compact volume; the multitrack toggle.                                                                               |
| `MixerPanel`                                                      | Per track: instrument, effects preset, volume, pan, mute and solo, with the load status of a new instrument; the master volume and the GM tier bypass switch.                                    |
| `captureTrackSession`, `restoreTrackSession`, `watchTrackSession` | The per-song session the library keeps (WP-060): visibility, single-track view, mute and solo, current track; never notation.                                                                    |
| `TrackFlash`                                                      | The status bar's track-name flash and its polite announcement, on every change of the current track within the open score.                                                                       |
| `trackCommands` (`./commands`)                                    | Previous and next track (⌘↑ ⌘↓), go to track 1 to 9 (⌥1 to ⌥9), focus the tracks list or the score (⇧F6), multitrack view (F3), mute, solo, clear, show all, and notation for the current track. |

## Where each value lives

| Value                         | State                                                                                             | Undo | Modified | Saved in the file                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ---- | -------- | ----------------------------------------------------------------- |
| Volume, pan, instrument       | the score, through `setTrackProperties`                                                           | yes  | yes      | yes                                                               |
| Effects preset                | the score, `sound.preset`, through `setTrackProperties` (`TrackEffectsPicker`, `features/sounds`) | yes  | yes      | yes                                                               |
| Notation per track            | `document.view.notation`                                                                          | no   | yes      | yes, folded in on Save; a track without strings saved as standard |
| Visibility, single-track view | `document.view.tracks`, `view.only`                                                               | no   | no       | no (library, WP-060)                                              |
| Mute, solo                    | `playback.mixer`, the audio service's overrides                                                   | no   | no       | the file's own flags, as read                                     |
| Current track                 | `selection.currentTrack`                                                                          | no   | no       | no (library, WP-060)                                              |
| Master volume                 | `settings.masterVolume` (WP-051)                                                                  | no   | no       | no (a preference)                                                 |
| GM tier bypass                | `settings.gmTierBypass`, the master strip's "No automatic effects on GM sounds" switch            | no   | no       | no (a preference)                                                 |

## Decisions

- **The list keys are local, not registry commands.** With a track's name focused, the arrows, Home
  and End move, Enter selects, and M and S mute and solo it. The registry has no "list has focus"
  context, so these live in the sidebar's key handler (matched through `matchesShortcut`, so other
  layouts work) and are described in the shortcuts reference. The global keys (Alt+digit, Shift+F6) are
  registered, so overrides and the cheat sheet cover them. The key choices sit in `KEYS` in
  `commands.ts`.
- **Names are the roving tab stop; the row's controls are not.** The current track's name button
  is the one name in the Tab order, the others take focus from the arrows. Each row's eye, mute,
  solo, notation and volume stay Tab stops.

- **A slider previews while dragging and commits once.** `onValueChange` calls
  `audio.previewTrack`, which moves the strip only; `onValueCommit` applies one command. A drag is
  one undo step and one layout run; each keyboard step is one of each.
- **No rebuild for a mixer edit.** An edit that touches only track properties the timeline never
  reads (`timelineNeutral` in `@reprise/audio`) is applied by `AudioEngine.load` to the strips and
  instruments directly, so a change and its undo are heard at once during playback. A new
  instrument decodes its samples with progress in `playback.instrumentLoads`.
- **Rows take primitives.** The list computes each row's mute, solo and audibility, so a frame
  of playback position re-renders no row, and a volume edit re-renders one.
- **A track without strings offers standard notation only.** Tab and both stay in its menu,
  disabled, with the reason; `setTrackNotation` ignores them, and Save writes such a track as
  standard (#125).
- **Hidden tracks still sound.** Visibility is display only, as in Guitar Pro.
- **Instrument names are the GM tables in `lib/gm-programs.ts`**, not the sound bank's preset names,
  so the picker works before the bank loads.
