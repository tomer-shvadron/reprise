# Phase 5: Owner picks `[P]`

Parallel, in three waves. It lands **before the v1 release candidate**: the order is phase 5, then WP-100 (#311) and WP-103 (#314) from [phase 4](phase-4-release.md), then the rc, then WP-104 (#315). Exit condition: every issue below merged, so the light theme audit and the final budgets measure the UI that ships.

The issues (#333 to #355) already exist and carry the detail; this file records the decisions, the order and the dependencies. Milestone **Phase 5**, label `phase:5`.

## Where it came from

Two research pages, a Guitar Pro 8 gap analysis (features F001 to F180) and a set of layout options (L0 to L5 and the per-surface S-* options). On 2026-11-20 the owner chose:

- **L2** (today's arrangement, refined) as the main window, and **L4** as a practice mode.
- Per surface: **S-TOP-1** (slim header), **S-SIDE-1** (right panel, collapsible), **S-BOT-1** (bottom dock, collapsible), **S-STATUS-1** (split status bar), **S-CTX-2** (context menus on every interactive surface), **S-PAL-2** (palette prefixes), **S-FLOAT-2** (selection pill), **S-KEY-1** (which is WP-101, #312) and **S-PRAC-1** (speed-trainer chip and tuner button in the transport).
- The collapsible side panel and bottom dock are the owner's requirement, with their state persisted.

## Waves

Within a wave the issues run in parallel unless a "Blocked by" edge says otherwise.

| Wave | Issues                                                   |
| ---- | -------------------------------------------------------- |
| 1    | #343, #333, #312, #334, #335, #336                       |
| 2    | #337, #338, #339, #340, #341, #342, #344, #345, #346, #347 |
| 3    | #348 to #355                                             |

## Blocked by

The edges the issues state:

| Issue | Blocked by |
| ----- | ---------- |
| #338 palette prefixes | #312 |
| #341 focus practice mode | #333 |
| #344 configurable shortcuts | #312, #343 |
| #346 default sounds | #343 |
| #347 default notation per track kind | #343 |
| #352 chord library | #278 |

The other issues state no blocker. #343 (Settings dialog) is in wave 1 because three wave 2 issues build on it.

## Wave 1

- **#343** Settings dialog with persisted preferences. Size L; the plan may land the shell first and the sections after.
- **#333** Slim header with Play, Practice and Edit modes and the breadcrumb, view menu and search field (S-TOP-1). M.
- **#312** WP-101, the command palette and shortcut map (S-KEY-1). Moved here from phase 4.
- **#334** Tabbed, collapsible right panel with an icon rail (S-SIDE-1). S. A tab strip reads and sets `rightPanelView`; F8 keeps toggling; open state and width persist.
- **#335** Tabbed, collapsible bottom dock (S-BOT-1). S. Ships the strip with the Fretboard; later views widen `BottomPanelView`.
- **#336** Split status bar (S-STATUS-1). M. Coordinate contrast with #311.

## Wave 2

- **#337** Mode-aware context menus on every interactive surface (S-CTX-2). L; the plan may split the menu infrastructure from the per-surface PRs. Items come from the command registry, filtered by `Command.context`.
- **#338** Go-to-anything prefixes in the command palette (S-PAL-2). M.
- **#339** Selection pill, a floating toolbar over the selection (S-FLOAT-2). M.
- **#340** Speed-trainer chip and tuner button in the transport (S-PRAC-1). S.
- **#341** Focus practice mode (L4). M.
- **#342** Library and Sounds as dialogs or sheets, not full-window screens. M.
- **#344** Configurable keyboard shortcuts (F171). M.
- **#345** Move between tracks quickly with the keyboard. S.
- **#346** Default sounds: Emilyguitar "Five voices" for guitars, GM for the rest. M.
- **#347** Default notation per track kind when the file does not choose. S. See the ruling below.

## Wave 3

Features from the gap analysis, independent of the layout work except where noted.

- **#348** Missing instruments: banjo, mandolin, 12-string, more percussion. L; an audit, then one PR per family.
- **#349** Research: a roadmap for sampled sounds beyond GM. M, research only.
- **#350** ASCII tab export (F013). S.
- **#351** Export the score or a selection as PNG or SVG (F015). M.
- **#352** Chord library and naming a chord from its frets (F111, F040). L; the engine apart from the UI. Blocked by #278.
- **#353** Song insights: key, scales and what the song is made of. L.
- **#354** Golpe and pick scrape (F079). M.
- **#355** Wah-wah pedal marks with playback (F082). M.

## Ruling on #347

The owner's ruling of 2026-11-20 answers the three open questions:

1. **Vocals** means vocal tracks, and they can show tab. Vocal tracks and string instruments default to **tab**.
2. **Drums and keyboards** default to **standard**, since "both" can only mean standard for them.
3. **The default never overrides the file.** It applies only when the file gives no instruction: gp3 and gp4, gpif without a `PartConfiguration` entry for the track, and new tracks. The gp5 flags, the gpif `PartConfiguration` and a `.reprise` `display.notation` always win.

For the plan: today the readers disagree on a vocal track flagged as tab. The gpif reader keeps it fretted (`gpif/build-tracks.ts`); the gp3 to gp5 reader makes any non-fretted program pitched and drops the flag with `track-flags-dropped` (`gp3-to-5/tracks.ts`). Align them so a track whose file asks for tab keeps its strings, decide how a vocal track is recognised (GM programs 52 to 54, the track name, or both) and how one with no tuning gets strings, and add fixtures for both formats.
