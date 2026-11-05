# ADR-0008: Read every Guitar Pro format, save native, export gp

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

The machine has no existing Guitar Pro files, no music apps and no audio interface, so every
file will be downloaded, in practice from tab sites, in whatever format the uploader used.
The Guitar Pro family is three different parsers:

- **gp3, gp4, gp5**: one binary format with versioned extensions; the bulk of older tabs.
- **gp** (Guitar Pro 7 and 8): a zip containing an XML score; what new tabs are uploaded in.
- **gpx** (Guitar Pro 6): the same XML as gp, wrapped in a proprietary bit-packed container
  that needs its own decoder; very common for uploads from 2011 to 2017.

The owner wants to read all of these and asked to save to them as well, questioning why an
in-house format is needed if every Guitar Pro format is supported.

Reading and writing are not symmetric. A reader can be lenient and skip what it does not
understand; a writer must produce something the real Guitar Pro accepts, byte-exact for the
binary formats, and there is no Guitar Pro installed to check against. gpx in particular is
write-once-by-Arobas: no open-source project implements the container's encoder, and Guitar
Pro 7 and 8 themselves read gpx but save only gp. gp3 and gp4 are strict subsets of gp5.
Guitar Pro 8 treats older formats as lossy exports from its own native format.

A native format is needed regardless, because the model holds things Guitar Pro formats
cannot: practice loop regions, per-song progress and tempo history from the trainer, sound
pack assignments per track, unsaved editor drafts.

## Decision

- **Read**: gp3, gp4, gp5, gp and gpx, in v1. Format is detected from the file's bytes, not
  its extension.
- **Save**: the native format, JSON with a schema version, extension `.reprise`. It is the
  default for new files and for anything edited, and it is lossless with respect to the
  model. Readers of older schema versions migrate forward.
- **Export to gp** (GP7/8) in v1: a zip with the XML score. Shares the XML model with the gpx
  reader. Verified in tests by reading the output back with alphaTab.
- **Export to gp5** in phase 2.
- **Never write gpx, gp3 or gp4.**
- Exporting warns when something in the model will be dropped.
- **Deferred**: MusicXML import and export. **Left out**: MIDI import, ASCII tab import.

## Alternatives considered

- **gp3/4/5 only in v1**: fastest, but a visible fraction of downloads would fail to open,
  the worst first impression a player can make. Rejected.
- **Skip gpx**: same objection for the 2011 to 2017 era. Once the gp XML parser exists, gpx
  is only the container decoder on top, documented in TuxGuitar's and alphaTab's sources.
  Rejected.
- **No native format, Guitar Pro formats only**: loses the trainer's and editor's data, has
  no lossless round-trip to test against, and makes the editor's save depend on the hardest
  writers. Rejected; the owner accepted the reasoning.
- **gp5 export in v1**: wanted for sharing with older software and tab sites, but the binary
  writer is fiddly and gp export covers current tools. Deferred to phase 2.

## Consequences

- The `formats` package holds three readers, a format sniffer, the native serializer and
  the gp writer; it depends only on the `model` package.
- The gpx reader's container decoder is an isolated, well-tested unit; the XML parser is
  shared with gp.
- Round-trip tests (read, save native, read again, compare) are the formats package's main
  safety net. See `0015-testing-strategy.md`.

## Related

- `../specs/shared-understanding.md`
- `../reference/file-formats.md`
- `0006-score-model-scope.md`
- `0012-library-app-dexie.md`
- `0015-testing-strategy.md`
