# Decision records

Every product, scope and architecture decision for Reprise is recorded here as an
architecture decision record (ADR): the context that forced the decision, what was decided,
the alternatives that were rejected and why, and the consequences. The records exist so that
anyone, including an agent picking up an issue, can see why things are the way they are
without re-deriving or re-litigating them. The first seventeen were written from the planning
session of 2026-11-05, 0018 and 0019 from the phase-0 reviews the same day, 0020 from the switch off Fable on 2026-11-06, 0021 from the lead's ruling on PR #68 the same day, 0022 from the lead's ruling on #28, 0023 from the lead's ruling on #32, 0024 from the lead's rulings on #48, and 0025 from the lead's ruling on #51; see `../specs/shared-understanding.md` for the session's summary.

Rules:

- A new decision gets a new numbered file, `NNNN-kebab-slug.md`, with the next free number.
  Never renumber or rewrite an accepted record to say something different.
- Reversing or replacing a decision is a new record. The old one keeps its content and its
  **Status** line changes to `Superseded by ADR-NNNN`.
- Routine defaults that were assumed rather than decided are marked "default unless
  revisited" inside the record that mentions them.
- No time estimates in records.

| ADR  | Title                                                               | Status                                                               |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0001 | Reprise is a player, a trainer and an editor, each at an 80/20 cut  | Accepted                                                             |
| 0002 | Build the core, borrow the commodities                              | Accepted                                                             |
| 0003 | Desktop only, web core, Electron shell                              | Accepted                                                             |
| 0004 | One sampler engine of our own, fed by SF2 and SFZ loaders           | Accepted                                                             |
| 0005 | Memory is a first-class requirement                                 | Accepted                                                             |
| 0006 | What the score model represents                                     | Accepted                                                             |
| 0007 | Per-track notation toggle, rhythm stems under tab always            | Accepted, superseded in part by ADR-0021                             |
| 0008 | Read every Guitar Pro format, save native, export gp                | Accepted                                                             |
| 0009 | pnpm workspace monorepo with six packages, no build orchestrator    | Accepted                                                             |
| 0010 | SVG painter with virtualized systems and geometry-based hit-testing | Accepted                                                             |
| 0011 | Immutable model, named commands, undo as patch replay               | Accepted                                                             |
| 0012 | A library app, with metadata in IndexedDB through Dexie             | Accepted                                                             |
| 0013 | Guitar Pro's arrangement, a modern minimal style, dark by default   | Accepted                                                             |
| 0014 | Public repository, issue-driven work, PR review in GitHub           | Accepted; label families and credential notes superseded by ADR-0018 |
| 0015 | Testing that fits a notation and audio app                          | Accepted, superseded in part by ADR-0023 and ADR-0025                |
| 0016 | Serial foundation and model core, then three parallel lanes         | Accepted                                                             |
| 0017 | The project is called Reprise                                       | Accepted                                                             |
| 0018 | Label families and repository credentials                           | Accepted                                                             |
| 0019 | Review by a stronger model before merge                             | Accepted, superseded in part by ADR-0020                             |
| 0020 | Plan and review with Opus at xhigh effort                           | Accepted                                                             |
| 0021 | Rhythm on the standard staff in both mode                           | Accepted, extended by ADR-0022                                       |
| 0022 | In both mode, lane effects are drawn once, on the tab staff         | Accepted                                                             |
| 0023 | Visual regression in Vitest browser mode                            | Accepted                                                             |
| 0024 | Mixer values are score data; mute and solo are session state        | Accepted                                                             |
| 0025 | End-to-end flows on the web build in Chromium                       | Accepted                                                             |
