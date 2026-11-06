# ADR-0021: Rhythm on the standard staff in both mode

- **Status**: Accepted
- **Date**: 2026-11-06
- **Deciders**: the lead's ruling on PR #68, which the owner can overrule

## Context

ADR-0007 gives each track a display mode (tab, standard or both) and says "Rhythm stems,
beams and flags are drawn under the tab in every mode", because "a tab without timing
information is unplayable".

The phase 2 plan reads both mode differently. WP-023 in `../plans/phase-2-lanes-to-player.md`
says that when a track shows both, "the standard staff sits above the tab with stems only on
the standard staff and tab numbers without rhythm notation, per Guitar Pro's 'both' mode".
The two readings met when the tab staff (WP-021) and the standard staff (WP-023) were built in
parallel: the question came up on #59 (the thread on `staff-module.ts:26`), and on #68 the
lead ruled (ruling 3, 2026-11-05) that the plan's reading wins.

#68 implements that ruling. The tab module draws its rhythm only when it is the track's only
staff (`packages/layout/src/staves/tab/analysis.ts`), and the `layout()` test "leaves rhythm to
the standard staff through layout()" (`packages/layout/src/staves/tab/tab.test.ts`) checks that
in both mode the tab has no rhythm primitives while the standard staff carries them.
`../reference/notation.md` ("Both mode (WP-023)", from #70) documents the rule.

## Decision

It supersedes ADR-0007's "in every mode" bullet for both mode; the rest of ADR-0007 stands.

- **In both mode, the rhythm notation is drawn on the standard staff only**: stems, beams,
  flags, rhythm dots, rests and tuplets.
- **The tab leaves dynamics and fingering to the standard staff**, so each is drawn once. The
  tab still shows fret numbers, grace numbers, ties, chord names, beat text and lyrics, which
  the standard staff does not draw.
- **Tab mode is unchanged**: a tab shown on its own draws its rhythm under the numbers, as
  ADR-0007 decided.

### ADR-0007's rationale

ADR-0007 calls rhythm under the tab "not optional" because a tab without timing is
unplayable. In both mode the tab is never without timing: the standard staff sits directly
above it on the same horizontal spacing (ADR-0007's first consequence), so each fret number
lines up with the note, stem and beam that time it. The reason holds for tab mode, where the
tab is the only staff, and does not reach both mode.

## Alternatives considered

- **Rhythm on both staves**, ADR-0007 as written: the same stems, beams and rests twice, one
  staff apart, in a mode that already costs twice the vertical space. It also departs from
  Guitar Pro's "both", which the plan follows. Rejected.
- **Rhythm under the tab only, the standard staff without stems**: a five-line staff without
  rhythm is not standard notation. Rejected.

## Consequences

- A tab staff module knows it is in both mode from `StaffBar.staves`, which then holds two
  staves; `../reference/notation.md` describes what each staff draws.
- ADR-0007's title still reads "rhythm stems under tab always"; its status line points here.
- `../specs/shared-understanding.md` and `../reference/glossary.md` state the both-mode
  exception.

## Related

- `0007-notation-display-modes.md`
- `../plans/phase-2-lanes-to-player.md` (WP-021, WP-023)
- `../reference/notation.md`
