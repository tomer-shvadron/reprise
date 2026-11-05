# ADR-0006: What the score model represents

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

Guitar Pro files contain fretted-string tracks, drum tracks, keyboard tracks and arbitrary
General MIDI instruments on standard-notation staves, with up to four voices per bar. Every
instrument type the model represents adds notation rules, a rendering path and a sound
mapping. The recommendation was fretted strings plus drums for v1; the owner chose
everything.

## Decision

The model represents, in v1:

- **Fretted strings**: 6 and 7-string guitar, 4 and 5-string bass, any tuning, capo.
- **Drums** on a percussion staff, mapped to the General MIDI drum kit.
- **Pitched, non-fretted instruments** (piano, strings, brass, anything else in a file) on a
  **single staff** with a treble or bass clef, key signature, accidentals, stems and beams.
  The grand staff is deferred; until then both hands of a piano part are collapsed onto one
  staff.
- **Four voices per bar are stored**, as Guitar Pro files require, so imports are lossless.
  **Two voices are editable** in v1; editing voices three and four is deferred.
- **Stable IDs on every node**: track, bar, beat and note. Guitar Pro files are positional,
  so readers assign IDs on import. Selections, loop ranges, layout caches and practice-log
  references point at IDs, not indices.
- Chord diagrams, lyrics, section markers, tempo and time-signature and key-signature
  changes, repeats, alternate endings, and D.S./D.C./coda jumps are part of the model
  because real files contain them and playback is wrong without them.

## Alternatives considered

- **Fretted strings only**: other tracks kept for playback but shown as a muted placeholder.
  Rejected by the owner.
- **Fretted strings plus drums**, the recommendation: a piano staff is a third notation
  system and most of its work benefits tracks the owner will never play. Rejected by the
  owner in favour of complete coverage, with the 80/20 cut applied to the notation instead
  (single staff, no grand staff).

## Consequences

- A standard-notation renderer is in v1 scope, which makes standard notation for guitar
  tracks nearly free. See `0007-notation-display-modes.md`.
- The model must carry enough per-note information for both tab and standard notation:
  string and fret for the former, pitch and spelling for the latter, derived through tuning
  and capo.
- Playback does not depend on notation type; the sampler plays every track the same way.

## Related

- `../specs/shared-understanding.md`
- `0007-notation-display-modes.md`
- `0008-file-formats.md`
- `0011-immutable-model-command-undo.md`
