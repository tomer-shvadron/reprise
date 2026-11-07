# ADR-0024: Mixer values are score data; mute and solo are session state

- **Status**: Accepted
- **Date**: 2026-11-07
- **Deciders**: the lead's rulings on #48, which the owner can overrule

## Context

The track sidebar and the mixer (WP-052) change four kinds of thing: what a track sounds like
(volume, pan, instrument), whether it sounds at all right now (mute, solo), what the score shows
(visibility, single-track view, notation per track), and which track is current. Guitar Pro keeps
volume, pan, instrument, mute and solo in its file. Each needs one owner, an answer to "does undo
revert it" and "does Save write it", and a path to the audio engine that does not stop playback.

The plan on #48 proposed the split; the lead's rulings on its questions settled it. The decisions
below record ruling 3 (the instrument is score data), ruling 2 (mute and solo are never written),
ruling 1 (notation is saved into the file, as ADR-0007 says) and ruling 4 (undo and redo as
commands). Visibility as view state follows the lead's ruling on #46 Q6.

## Decision

- **Volume, pan and the instrument (GM program) are score data.** They change through
  `setTrackProperties`, so they are undoable, mark the document modified, and are saved to
  `.reprise` and to gp export. The instrument picker and WP-083's track dialog share the same
  command.
- **Mute and solo are session state.** The UI's toggles are the audio service's per-song
  overrides (`playback.mixer`), never a command and never written: Save writes each track's mute
  and solo flags as the file had them (gp5 track flags, the gpif `PlaybackState`), which the
  readers keep as the baseline under the overrides. A file saved soloed therefore opens soloed.
- **Notation per track is saved into the file**, as ADR-0007 says: the view's notation map is
  folded into each track's `display.notation` when Save writes, in `.reprise` and in gp (whose
  gpif records the per-track staff flags). It stays out of the undo history, but a change marks
  the document modified until the next save.
- **Visibility and single-track view are view state**: never undoable, never dirtying, kept per
  song by the library (WP-060) through `features/tracks/session.ts`. The saved session never
  carries notation, which lives in the file, so restoring a song's view, mute and solo after Save
  and reopen leaves the document unmodified.
- **A timeline-neutral edit reaches the sampler without rebuilding the sequence.** An edit that
  changes only track properties the timeline never reads (name, colour, display, channel,
  program, lyrics) is applied to the channel strips and instruments directly, so volume, pan and
  instrument changes, and their undo and redo, are heard at once during playback.
- **Undo and redo are commands** (⌘Z, ⇧⌘Z, and Ctrl+Y on Windows) over the document's history;
  the desktop Edit menu calls them, and a focused text field keeps its own undo.

## Alternatives considered

- **Every mixer value as a per-song override**, the file left untouched: one less kind of state,
  but the instrument picker and the track dialog would then disagree about the program, and a
  balanced mix could not be shared in the file. Rejected.
- **Mute and solo as score edits**: practice toggles would fill the undo history and dirty the
  document. Rejected, as in Guitar Pro, where toggling them does not ask to save.
- **Notation as library-only view state**: simpler, but loses the choice when a file is shared,
  against ADR-0007. Rejected.

## Consequences

- The document is modified by a notation change with nothing to undo; undoing to the saved
  point while a notation change is unsaved still leaves it modified.
- A beat's mixer change in the file overrides a committed volume or pan from its beat until the
  next stop, run start or loop wrap, as in Guitar Pro.
- WP-060 persists `TrackSession` per song: visibility and single-track view, the mute and solo
  overrides and the current track, never notation.

## Related

- `0007-notation-display-modes.md`
- `0011-immutable-model-command-undo.md`
- `0013-ui-layout-and-style.md`
