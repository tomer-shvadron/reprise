# ADR-0017: The project is called Reprise

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The project had no name. Four candidates were proposed, each tied to the product or to the
reason it exists: the owner coming back to playing guitar.

## Decision

**Reprise.** The musical term for a section returning, and the reason the project exists. It
is short, works as both a noun and a verb ("open it in Reprise"), and gives a clean
repository slug.

- Repository: `tomer-shvadron/reprise`.
- Package scope: `@reprise/*`.
- Native file extension: `.reprise` (JSON inside; see ADR-0008).

## Alternatives considered

- **Fretwork**: guitar craft and the work done on the frets; grounded but plain.
- **Sustain**: a guitar term and a hope; reads abstract as an app name.
- **Plectrum**: distinctive and old-fashioned; says nothing about learning.
- **Capo**: avoided deliberately, an existing macOS music app uses the name.

## Consequences

- The name appears in the repository, the package scope, the app title, the library folder
  under the Music directory, and the file extension.

## Related

- `../specs/shared-understanding.md`
- `0001-vision-player-trainer-editor.md`
- `0008-file-formats.md`
