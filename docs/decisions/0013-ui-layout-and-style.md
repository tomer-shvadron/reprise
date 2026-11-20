# ADR-0013: Guitar Pro's arrangement, a modern minimal style, dark by default

- **Status**: Accepted
- **Date**: 2026-11-05
- **Deciders**: Tomer Shvadron, with Claude

## Context

Two separate things had to be decided: where things go on screen, and what they look like.
Guitar Pro's arrangement is well earned and is the owner's muscle memory. Its visual style is
toolbar-heavy, icon-grid, light grey chrome, and would mean fighting Tailwind to reproduce.
The owner's previous project already uses shadcn/ui components on Radix.

## Decision

**Layout** follows Guitar Pro's arrangement:

- track list on the left, with mute, solo, volume and the per-track notation toggle;
- the score in the center, with the most space;
- a transport bar pinned to the bottom: play, loop, count-in, metronome, tempo;
- collapsible panels for the fretboard, the mixer and the speed trainer.

**Style**:

- modern and minimal, built from shadcn/ui components on Radix with Tailwind;
- **dark theme by default; a light theme is required**, not optional;
- the score surface is paper-coloured on dark chrome, which reads best in long sessions and
  prints without an inversion step;
- keyboard-first, with a command palette for everything that would otherwise be a toolbar
  button;
- keyboard shortcuts mirror Guitar Pro's where they exist (default unless revisited);
- English-only UI (default unless revisited).

## Alternatives considered

- **Mimic Guitar Pro's look**: dated and expensive to reproduce. Rejected; its arrangement is
  kept, its chrome is not.
- **Fully dark score surface**: slick, but printing would need an inversion step. Rejected in
  favour of paper-on-dark.

## Consequences

- Theme tokens are defined once and every surface, including the SVG score, reads them, so
  the light theme is a token set rather than a second stylesheet.
- A light-theme audit is a named task in the release checkpoint.
- The command palette and shortcut map are release-checkpoint work; the shortcut reference
  lives in `../reference/keyboard-shortcuts.md`.
- Changed by #206 (2026-11-16): the layout gains a collapsible bottom region above the transport,
  one view at a time (the live fretboard first), with a resizable remembered height; see
  "Changed by #206" in `../specs/architecture.md`.
- Changed by #333 (2026-11-20): a slim header band (S-TOP-1) above the score, with the library
  breadcrumb, Play and Edit modes, a View menu and a command-palette search. The arrangement is
  otherwise unchanged. See "Changed by #333" in `../specs/architecture.md`.
- Changed by #334 (2026-11-20): the right panel is tabbed (Mixer, Practice, Effects, History) and
  collapses to an icon rail that stays visible; its open state and width are remembered. See
  "Changed by #334" in `../specs/architecture.md`.
- Changed by #336 (2026-11-20): the transport footer gains a status bar below it (S-STATUS-1): the
  song's state on the left, the edit cursor and the view on the right. The arrangement is
  otherwise unchanged. See "Changed by #336" in `../specs/architecture.md`.
- Changed by #337 (2026-11-20): context menus come from one host (the header and the right panel
  first, the other surfaces in later parts): the right-click and Shift+F10 route to the same menu,
  and what a menu lists depends on the mode. The arrangement is unchanged. See "Changed by #337" in `../specs/architecture.md`.
- Changed by #338 (2026-11-20): the command palette takes go-to prefixes (`#` sections, `@` tracks,
  `/` songs, a number for a bar) and ⌘G opens it on a bar number. The arrangement is unchanged. See
  "Changed by #338" in `../specs/architecture.md`.
- Changed by #335 (2026-11-20): the bottom region is a tabbed dock (S-BOT-1) that collapses to its
  tab strip; its open state and height persist as settings. See "Changed by #335" in
  `../specs/architecture.md`.
- Changed by #343 (2026-11-20): the theme is a setting with three values, System, Light and Dark, and
  System, which follows the operating system, is the default, so "dark theme by default" holds only
  where the system is dark. See "Changed by #343" in `../specs/architecture.md`.
- Changed by #342 (2026-11-20): non-score views open as modal dialogs or sheets over the player,
  never as full-window screens; the Library and the Sounds manager are bottom sheets over a dimmed
  player. See "Changed by #342" in `../specs/architecture.md`.

## Related

- `../specs/shared-understanding.md`
- `0003-desktop-only-electron.md`
- `0010-svg-renderer-virtualized.md`
