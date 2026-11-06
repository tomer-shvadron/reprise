# ADR-0022: In both mode, lane effects are drawn once, on the tab staff

- **Status**: Accepted
- **Date**: 2026-11-06
- **Deciders**: the lead's ruling on #28, which the owner can overrule

## Context

ADR-0021 put the rhythm notation on the standard staff in both mode and sent dynamics and
fingering there too, "so each is drawn once". It said nothing about note effects, which did not
exist yet.

WP-022 (#28) draws every effect the model holds. Most of them do not sit on a note head:
bends rise into a row above the staff, and palm mute, let ring, harmonics, vibrato, whammy-bar
vibrato, trills, the whammy graph, pick strokes, fades, tapping, slapping and popping each get
a row of their own (a *lane*) above the staff, sized per system so the rows line up across bars.
In both mode a track has two staves, and each lane could be drawn on either or on both.

alphaTab (`@coderline/alphatab` 1.8.4, our reference for Guitar Pro's layout) draws most of these
on both staves; it puts palm mute only on the tab, and fades on the tab whenever there is one.
Guitar Pro itself draws the tab's effect bands under the standard staff and leaves the standard
staff with what is attached to its note heads.

The implementation plan on #28 asked whether to record the answer in `notation.md` only or in
an ADR; the lead ruled (ruling 2 on #28) that, ADRs being append-only, it is a new ADR that
extends ADR-0021.

## Decision

It extends ADR-0021; ADR-0021 stands, including its rule that dynamics and fingering go on the
standard staff in both mode.

- **In both mode, every lane effect is drawn once, on the tab staff**: bends, pick strokes,
  palm mute, let ring, harmonic labels, fades, tapping, slapping and popping, vibrato,
  whammy-bar vibrato, trills and the whammy graph. The standard staff draws none of them.
- **What is attached to a note head stays with the heads**, on the staff that draws them:
  articulations (staccato, accents) and tremolo strokes on the stems belong to the standard
  staff in both mode, as the rhythm does under ADR-0021, and are drawn by it (#86).
  Connections between notes (ties, slides, hammer-on and slide arcs) are drawn on each staff
  that shows the notes, since each staff's arcs join its own numbers or heads; the `H`, `P` and
  `sl.` letters are written once, on the tab.
- **A track shown alone** draws its lane effects on its only staff: the tab in tab mode, the
  standard staff when it is shown as standard (#86).

### Why the tab

In both mode the tab sits under the standard staff on the same horizontal spacing, so a lane
on the tab is as close to its notes as one on the standard staff would be, and the bands sit
between the two staves where Guitar Pro puts them. Most lane effects are guitar techniques
written in tab terms (P.M., let ring, harmonic kinds, whammy bar); the tab is where a guitarist
reads them.

## Alternatives considered

- **Lane effects on both staves**, as alphaTab draws most of them: every label, wave and bend
  twice, one staff apart, in a mode that already costs twice the vertical space, and the same
  duplication ADR-0021 removed for rhythm and dynamics. Rejected.
- **Lane effects on the standard staff**: the rows would sit above the standard staff, away
  from the fret numbers that bends start from, and a bend would have to be drawn from note
  heads up to the lane while the tab shows the fret. Rejected.

## Consequences

- A staff module decides from `StaffBar.staves` which lanes it requests: the tab requests every
  effect lane in both mode except the articulation lane, and the standard staff requests only
  its dynamics lane (and, from #86, its effect lanes when it is the track's only staff).
- `../reference/notation.md` lists, per effect, what each staff draws in both mode.

## Related

- `0007-notation-display-modes.md`
- `0021-rhythm-on-the-standard-staff-in-both-mode.md`
- `../reference/notation.md` ("Note effects (WP-022)")
