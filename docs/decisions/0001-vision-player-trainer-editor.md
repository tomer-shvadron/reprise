# ADR-0001: Reprise is a player, a trainer and an editor, each at an 80/20 cut

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The owner played guitar a lot when younger and learned songs with Guitar Pro. The goal of
this project is to play again, using a tool of their own instead of a commercial one.

Guitar Pro is three products in one: a player that opens a tab file, renders it, plays it
back and lets you slow down and loop; an editor that writes tabs note by note; and a trainer
with a speed trainer, metronome and tuner. The first question of the planning session was
which of the three the project actually is, because the answer shapes everything downstream.

## Decision

All three. Reprise is a player, a trainer and an editor, for personal use, with each product
cut to the 80/20 of what Guitar Pro offers. Every feature is explicitly placed in one of
three lists, recorded in `../specs/shared-understanding.md`:

- **v1**: built and shipped in the first release.
- **Deferred**: wanted, not in v1, kept on the roadmap.
- **Dropped**: deliberately left out, with the reason.

The ordering of work still favours the player, because the trainer and the editor both sit on
it, and because "I can learn a song with it" is the first useful checkpoint. See
`0016-build-order-and-parallel-lanes.md`.

## Alternatives considered

- **Player only, trainer later, editor never**: the recommendation offered first, since the
  stated goal is learning and practice rather than authoring, and an editor is a large share
  of Guitar Pro's total effort. Rejected by the owner: all three are wanted, at reduced scope.
- **Editor first**: rejected; nothing useful exists until the player works, and the editor
  depends on the renderer and the model that the player exercises first.

## Consequences

- The score model has to be built for editing from the start, even though the editor ships
  last: stable IDs, commands, undo. See `0011-immutable-model-command-undo.md`.
- Scope is controlled by the three lists, not by feel. Moving an item between lists is a
  decision and gets recorded.
- Nothing in the editor list is dropped outright; two items that were proposed as dropped
  (page layout customization, engraving extras) were moved to deferred at the owner's
  request.

## Related

- `../specs/shared-understanding.md`
- `0016-build-order-and-parallel-lanes.md`
- `0017-name-reprise.md`
