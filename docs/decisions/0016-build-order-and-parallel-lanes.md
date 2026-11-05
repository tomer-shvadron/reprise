# ADR-0016: Serial foundation and model core, then three parallel lanes

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

A linear milestone list was proposed and accepted, then the owner asked whether anything
could be done in parallel with sub-agents. The dependency graph is friendlier than the
linear list: the layout, audio and formats packages depend only on the model and not on
each other, so once the model's types exist they are independent lanes.

Parallel agents have real costs: they only work when the interface they code against is
frozen and each touches only its own package; each needs the decision records and specs as
a briefing; integration between lanes is work that does not happen on its own; and several
agents at once consume tokens several times as fast as one.

## Decision

**Serial first, done by the lead:**

1. **Foundation**: workspace, lint boundaries, CI, docs tree, Electron shell that opens a
   window.
2. **Model core**: types, stable IDs, timing, commands, undo, native format. This is the
   contract every lane codes against; parallelizing it would produce incompatible ideas of
   what a beat is.

**Then three parallel lanes**, each one agent in its own git worktree, each owning exactly one
package:

- **Score lane**: layout engine, tab and standard staves, SVG painter, printing; later the
  editor UI.
- **Audio lane**: sampler core, GM soundfont loader, scheduler; later effects, SFZ and sound
  packs.
- **Formats lane**: gp5 reader, then gp and gpx readers, the gp writer; later the library and
  import flow.

Independent of all three: the tuner and the standalone metronome.

**Sync points**, where the lead integrates lanes into the app, in this order:

1. **Player checkpoint**: rendering plus the audio engine plus the gp5 reader, wired to a
   transport bar. The first usable version.
2. **Library checkpoint**: remaining readers, the gp writer, the Dexie library.
3. **Trainer checkpoint**: speed trainer on the player loop, practice log on the library.
4. **Editor checkpoint**: hit-testing and the command model surfaced in the UI.
5. **HQ sound checkpoint**: SFZ, sound pack manager, effects, memory budget tuning.
6. **Release**: light theme audit, command palette and shortcuts, Windows build, GitHub
   Release.

**Editor before HQ sound**: the editor exercises the model hard and surfaces design bugs
while they are cheap; HQ sound depends on external downloads and can slot in whenever. The
owner may flip this if hearing a real guitar tone matters more than writing tabs.

**Working mode**: each agent works on an issue branch in a worktree and opens a PR; the owner
reviews in GitHub; the lead merges after CI and approval and does the integration PRs.

## Alternatives considered

- **Fully linear milestones**: safe, slower; rejected once the independence of the three
  packages was established.
- **Parallelizing the model core too**: rejected; it is the shared contract.
- **Parallel agents during the foundation**: rejected; there is no independent work yet.

## Consequences

- The plan in `../plans/` marks every work package as serial, lane-parallel, or integration.
- The model core must be complete and frozen (types, commands, serialization) before fan-out;
  changes to it afterwards are coordinated through the lead.
- Issues are written to be self-contained briefings, because the docs tree is the only
  context an agent has.

## Related

- `../specs/shared-understanding.md`
- `../plans/roadmap.md`
- `0009-monorepo-pnpm-workspaces.md`
- `0011-immutable-model-command-undo.md`
- `0014-repo-and-process.md`
