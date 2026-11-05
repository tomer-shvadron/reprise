# ADR-0011: Immutable model, named commands, undo as patch replay

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

Unlimited undo and redo is table stakes for the editor and shapes the whole state design, so
it has to be decided before the model package is written. Memory has been flagged as a
priority, which rules out snapshotting a long score on every keystroke. The layout should
recompute only what an edit touched.

## Decision

- **The score is immutable data updated through Immer.** Every edit is a **named command**
  that produces a set of patches and inverse patches.
- **Undo and redo are patch replays** over stacks of patch sets. Memory per step is
  proportional to what changed. Commands can be grouped into one undo step (a transaction)
  for compound edits such as paste.
- **Zustand holds the document and the UI state** in the web app; the command and history
  implementation lives in the `model` package and has no UI dependency.
- **Layout is recomputed only for the bars a patch touched**, which the patches identify by
  node ID.
- The command log is kept in development builds as a debug trace.

## Alternatives considered

- **Mutable model with a full snapshot per undo step**: simplest; the memory cost on a long
  score is exactly what the owner wants to avoid. Rejected.
- **Event sourcing**, the document as the command log replayed into state: elegant and more
  than this needs. Rejected.

## Consequences

- Every model type must be plain, JSON-serializable data, which the native format of ADR-0008
  needs anyway.
- Stable IDs (ADR-0006) are what make patches addressable and layout invalidation precise.
- The command set is defined and tested in the model package during the serial model-core
  milestone, before the parallel lanes start, so that readers, layout and audio all consume a
  frozen contract.

## Related

- `../specs/shared-understanding.md`
- `0006-score-model-scope.md`
- `0008-file-formats.md`
- `0016-build-order-and-parallel-lanes.md`
