# Score painter

Paints a `LayoutResult` from `@reprise/layout` as SVG (WP-024, ADR-0010). React and CSS only; the painter reads no store and lays nothing out. The caller computes the layout outside render, with `viewLayoutOptions`, and passes it in; for a print, the print store runs the print layout (see Printing).

## API

```tsx
<ScoreView layout={result} zoom={ui.zoom} label={`Score: ${title}`} overlays={...} onScorePointer={...} onUserScroll={...} ref={handle} />
<ScorePages layout={printResult} />
```

| Export                                                                     | What it is                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScoreView`                                                                | The scrolling score: a focusable `region`, paper for the pages in view or holding a mounted system, SVG only for the systems in view plus one either side, overlays, pointer input.                                                                                                                   |
| `ScoreViewHandle`                                                          | `revealRect(rect, { margin?, behavior? })` scrolls the least distance that shows a layout rectangle; `viewport()` is the visible window in layout px; `setPlayhead(cursor)` moves the playhead by writing its styles; `followPlayhead({ mode, running, track?, force? })` scrolls to keep it in view. |
| `playheadAt`, `pointerTarget`, `nearestColumn`, `barColumns`, `staffBand`  | The playhead for a master bar and a tick into it; where a click seeks; the bar column at or nearest a point; a bar range's columns, every part's; a track's staves in a system.                                                                                                                       |
| `createGestureTracker`                                                     | Turns pointer events into clicks and drags over bar columns (`gestures.ts`).                                                                                                                                                                                                                          |
| `ScorePages`, `ScorePage`                                                  | Every page and system with no virtualization, for printing; `ScorePage` draws `children` inside its page box (a header, a page number) and carries the score tokens, so it paints alone.                                                                                                              |
| `viewLayoutOptions(view, content)`                                         | `LayoutOptions` for paged (A4, Letter) or continuous mode, always at zoom 1. `uniformNotation` shows every track in one notation.                                                                                                                                                                     |
| `findAnchors`, `columnAnchor`, `cursorAt`, `cursorForBeat`, `anchorIndex`  | Anchor lookups by model id, cached per result, and the playback cursor for a note, beat or bar.                                                                                                                                                                                                       |
| `PrintDocument`, `PrintRoot`, `PrintDialog`                                | The printed pages with header and page numbers; the job's portal into `body`; our Print dialog.                                                                                                                                                                                                       |
| `createPrintStore`, `layoutForPrint`, `printHeading`, `printLayoutOptions` | The print flow's store, and the print layout pass at the paper size.                                                                                                                                                                                                                                  |
| `loadScoreFonts`, `useScoreFonts`                                          | Bravura and Geist, loaded once; nothing paints before both settle.                                                                                                                                                                                                                                    |

`onScorePointer` receives `{ type: 'down' | 'move' | 'up' | 'leave' | 'cancel', point, anchor, column, event }`: the point in layout px, the anchor `hitTest` finds there, the master-bar column at or nearest the point on the page under it (both none on `leave` and `cancel`), and the native event for buttons and modifiers. `cancel` ends a drag that gets no `up`. A primary press takes pointer capture, so a drag keeps its moves outside the canvas. `onUserScroll(axis)` reports a hand scroll: the wheel (`x` with Shift or a mostly sideways delta, nothing with Ctrl), a scrollbar press, touch, a middle-button press (`both`), and a scrolling key that no command took.

`overlays` takes `selection`, `loop` (bar columns, drawn as a faint tint with an accent top edge) and `hover`.

The app's `ScorePane` (`apps/web/src/app/score-pane.tsx`) mounts `ScoreView` in the score region with the layout store's result, and an empty state until there is one. It starts the playhead driver (`app/playhead-driver.ts`), turns clicks into seeks and drags into bar selections, draws the selection and the loop, and shows **Follow playback** while following is paused during playback.

```text
ScoreView            region: scroll container, virtualization, zoom anchoring, pointer → hitTest
 └ sizer             scroll extent: canvas × zoom plus a 32 px gutter
    └ canvas         layout (0, 0); the only element with pointer handlers
       ├ ScorePage   paper, positioned at its page × zoom
       │  └ SystemSvg     one <svg> per mounted system, viewBox = its bbox, keyed by system id, memoized
       │     └ SystemPrimitives   one element per primitive, memoized
       ├ OverlayLayer     loop, selection, hover
       └ PlayheadLayer    bar highlight and line, memoized; styles written by the handle only
```

## Decisions

- **Glyphs are Bravura codepoints in `<text>`**, never paths: `String.fromCodePoint(codepoint)` at `font-size` = `size`, at the glyph origin on its baseline, which is SVG's default text anchoring. Text is Geist at weight 400 with kerning and ligatures off and `white-space: pre`, as layout measured it.
- **Colour is `currentColor` and a role class.** `ink` inherits the system's colour; `paper`, `muted` and `accent` get `score-role-*`, whose `color` is a score token (`--score-ink`, `--score-paper`, …) defined in `score.css` from the theme's paper family in `index.css`. A theme switch is a CSS variable change: no render, no layout. Presentation attributes do not take `var()` reliably, which is why colour goes through `color`. No colour literal appears in the feature (tested).
- **Fonts gate painting.** Bravura loads through `FontFace` from `import.meta.env.BASE_URL`, which is `./` in the Electron build. Geist loads every declared face, one per unicode-range subset, so text outside latin does not reflow later. Until the fonts settle the region is `aria-busy` and only paper is drawn; a failed load warns and paints with a fallback.
- **Virtualization**: the systems whose box meets the visible window, plus one either side; with none in view (a gap between pages), the nearest one and its neighbours. Pages draw their paper for every page that holds a mounted system or meets the window. The rule is mode-agnostic: paged systems stack down, continuous ones run right.
- **One edit re-renders one system.** Systems are keyed by `system.id`, and `SystemSvg` and `SystemPrimitives` are memoized: equal props skip the render. Layout's cache reuses every unchanged system by identity and rebuilds only the systems within three bars of an edited bar, its neighbours as new objects with equal values, so the comparison checks identity first and values only where identity fails. `render-count.test.tsx` counts `primitiveToSvg` calls: an edit renders exactly the edited system's primitives, a zoom change none.
- **Paper is the page.** Layout splits a system taller than its page across pages (#85), so every system lies on its page: the view draws pages at the paper size and hit-tests the whole result.
- **Overlays sit above the notation.** Tab numbers sit on opaque paper knockouts, so a highlight underneath would show as holes; a translucent tint on top colours notes and knockouts alike. They are HTML boxes placed with `transform`, hidden in print.
- **Pointer input is geometry.** Handlers live on the canvas alone and call `hitTest`; systems are `pointer-events: none`, so the browser never hit-tests thousands of SVG nodes. `hitTest` finds nothing between systems or in a margin, so every event also carries the nearest bar column: the system containing the point or else the nearest one on that page, then the column containing its x or else the nearest.
- **The playhead moves outside React.** The engine writes a position every frame; the app's driver reads it at most once per frame (`startPositionReader`), maps it to a point with `playheadAt` and calls `setPlayhead`, which writes `transform`, `width`, `height` and `display` on two divs that React rendered once with no `style`, so a re-render never overwrites them. The line has its own compositor layer. A frame costs a binary search and a few style writes, and commits nothing (`playhead-view.test.tsx` counts commits under a `<Profiler>`; the browser test counts them in the app).
- **The playhead moves on an onset timeline.** Each master bar's column holds the x of every distinct onset across the visible staves (a beat anchor's centre, the top staff's where staves share an onset, lone rests skipped because the tab staff centres them in the bar) and its right edge at the bar's played length. x is linear between them, so the line glides across a beat rather than jumping, and every visible staff is covered, whichever track or voice is empty. The parts of a split system share x, so one timeline serves them all; the line and the bar highlight sit in the part that holds the current track, else the first. The engine's position names the written bar, so a repeat's second pass draws in the same place and a jump moves wherever the sequence goes.
- **The playhead shows what is heard, not what is scheduled.** While playing, the driver (`app/playhead-driver.ts`) draws the position `outputLatency + baseLatency` seconds behind the engine's clock, scaled by the speed, so over Bluetooth (150 ms and more) the line stays on the note in the speaker. It never draws before the start of the current stretch of continuous playback: Play, the end of a count-in, a seek and a loop wrap each start one, told by a position that moves back or further than the elapsed time allows. Behind that start lies the previous pass in playback order, anywhere in the score after a jump, and paged following would turn back to it; so the line holds at the start until the music reaches it, for the latency.
- **Following is page turns and a glide.** Paged, while playing: when the playhead enters a system and that system or the next is not fully in view, the view scrolls the current system to 24 px below the top, so the reader always sees the current and the next system; smoothly when the current one is on screen, instantly when it is not (a repeat or a jump back). While a smooth turn is in flight (until it arrives, or for a second), the horizontal reveal is measured from where the turn will end and joins it, because an instant scroll write would cancel it; this matters when the page is wider than the window. Continuous: the window approaches the line a third of the way in with a 200 ms time constant (`glide`), because onset spacing is uneven and pinning the line would make the page jitter; it snaps when the line leaves the window. A system taller than the window is followed by the current track's staves. On a system split across pages the current band is the current track's part, and the next is that track's part of the next system, not the continuation. With reduced motion every move is instant. Stopped or paused, the view moves only on a request (a seek, Play, Stop, **Follow playback**), so an edit's reload does not scroll back to bar 1.
- **A hand scroll pauses following** along the followed axis (y paged, x continuous; touch and the middle button both), told from input rather than `scroll` events, which following and zoom anchoring also fire. It resumes on the next seek, Play, Stop or **Follow playback**, never because the playhead wandered back into view.
- **Scrolling renders only when the mounted set changes.** The view keeps the live centre in a ref and sets its centre state, which re-renders it, only when the systems or pages to mount change. Continuous following scrolls every frame, and would otherwise commit every frame. A scroll is compared with the set of the last centre it requested, committed or not, so a scroll away and back before the first transition commits still mounts what is in view.
- **Clicks and drags** come from `createGestureTracker`: a primary press released within 4 px is a click at the press, anything longer a drag over bar columns. `pointerTarget` turns a click into a seek target: a note or beat's own onset, else the column's onset nearest the point, which is the bar's start near its barline.
- **Accessibility**: the scroll container is a `region` named by `label` (default `Score`), `aria-roledescription="score"`, focusable for keyboard scrolling, described by a "300 bars, 100 pages" summary. System SVGs (private-use codepoints) and overlays are `aria-hidden`. `revealRect` scrolls smoothly only when asked and reduced motion is not preferred.
- **Print path**: see Printing below.

### Printing

File › Print…, the palette and Cmd/Ctrl+P open our Print dialog (`print-dialog.tsx`): the tracks to print (those on screen by default, the list only with more than one track), A4 or Letter, a title header and page numbers. The paper and the switches are remembered for the session, never persisted. A file opened under the dialog (a shortcut, the native menu, a drop) refreshes its track list, keeping the chosen tracks while the score keeps the same tracks; closing the score closes the dialog. Focus returns to where it was when the dialog closes. Each track prints in the notation it shows. We ask first because the paper and the tracks decide the layout, which the system dialog cannot redo; printer, copies, ranges and Save as PDF stay the system dialog's, which is also why there is no Export PDF command.

Print… runs the flow in `print-store.ts`: paint "Preparing…", await `loadScoreFonts()`, run `layoutForPrint` (cold, paged, zoom 1, the paper's `PAGE_SIZES`, `headerHeight` for the title, whatever the screen's zoom and mode), close the dialog and mount the job. `PrintRoot` portals `PrintDocument` into `body`, beside `#root`; it signals the store once its pages commit, and only then is `platform.print({ pageSize })` called, once per job. The job and its DOM are dropped when the system dialog closes; `PrintRoot` selects only the job's id, so no fiber keeps the job's layout alive afterwards.

- **Header and page numbers** are HTML in `ScorePage`'s children, not layout primitives: the title (22 px on 30, weight 600; the file name without its extension when the score has none) and `artist — album` (13 px on 20, muted), centred with `dir="auto"` and an 18 px gap, 68 px in all, on page 1; `N / M` at 11 px centred in the bottom margin.
- **CSS** (`score.css`): `.score-print` is hidden on screen; in print it hides the body's other children and lets `html` and `body` grow past `index.css`'s `h-full overflow-hidden`, which would print one page. Named pages `reprise-a4` and `reprise-letter` are exactly `PAGE_SIZES` with no margin, selected by `data-paper`: ISO A4 is 0.5 px shorter, and a page box past it would spill a blank sheet. Pages clip, so a wide bar cannot trigger shrink-to-fit.
- **Light paper in every theme**: `.score-print` sets `--paper`, `--ink`, `--ink-muted` and `--paper-accent` to the light family `index.css` names on `:root` (`--paper-light`, …), so the score tokens resolve light inside it. Backgrounds do not print; knockouts and ink are SVG fills.
- **CSP**: no `<style>`, no `style` attribute markup; positions go through React's `style` prop (CSSOM), and the page size is a static named page.
- **Electron** passes `{ printBackground: false, margins: { marginType: 'none' }, pageSize }` to `webContents.print`, so the system dialog opens on our paper; the browser relies on `@page`.
- **The long score** (8 tracks, 300 bars, tab) prints 202 A4 pages: in Chromium's visual suite on an M4 Pro, 1.2 s from navigation to mounted pages in the dev server, about 173 000 DOM nodes and 188 MB of JS heap while the job lives, and 1.1 s and 1.2 MB for the PDF.

### Zoom

Zoom is display only: each system `<svg>` keeps its `viewBox` in layout px and takes `width`/`height` × zoom, and pages and canvas are sized and placed × zoom. Vector-crisp at every zoom, with exact scrollbars, which a CSS transform would not give. A zoom change re-renders sizes only; nothing inside a system changes (tested). The view keeps the layout point at the viewport's centre where it was.

Layout happens at zoom 1 and re-runs only when the width changes (mode, paper). Continuous mode lays out in fixed 640 px segments (`CONTINUOUS_SYSTEM_WIDTH`) rather than at the viewport width: the segments join seamlessly, so their width is invisible, but at zoom 0.5 on a 1 920 px viewport a viewport-wide segment would hold about 9 200 elements and three or four mounted ones would break the 20 000-element budget. With fixed segments the long score stays under 13 100 at every zoom (`budget.test.ts`).

## Demo: `/dev/score`

`pnpm dev`, then `/dev/score` (the dev server serves `apps/web/dev/score.html`). For measurements on production React: `pnpm --filter @reprise/web demo:build && pnpm --filter @reprise/web demo:preview`, then `/dev/score.html`. `vite build` builds `index.html` only, so the demo, the fixtures and `@reprise/model/testing` never reach the app or Electron bundles.

The URL is the demo's whole state:

| Parameter  | Values                                                                                                              | Default                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `fixture`  | `long` (the generated 8-track, 300-bar score) or a path under `fixtures/`, e.g. `gp5/staves.gp5`                    | `long`                     |
| `mode`     | `paged`, `continuous`                                                                                               | `paged`                    |
| `paper`    | `a4`, `letter`                                                                                                      | `a4`                       |
| `notation` | `default` (each track's own), `tab`, `standard`, `both`                                                             | `default`                  |
| `zoom`     | 0.5 to 3                                                                                                            | 1                          |
| `theme`    | `dark`, `light`                                                                                                     | the stored or system theme |
| `view`     | `scroll` (`ScoreView`), `pages` (`ScorePages`), `print` (`PrintDocument preview` alone; change the URL to leave it) | `scroll`                   |

The toolbar edits each, plus **Edit one note** (a `setNote` on the first beat of the first fretted track in the system at the viewport, re-laid out through the cache), **Play** and **Auto-scroll**. **Play** runs a fake clock on the model's tempo map for 10 s, driving `setPlayhead` and `followPlayhead` as the app's driver does, and records its frames like Auto-scroll. Pointer move hovers; pointer down selects and puts the clock there. `aria-busy="false"` on the region is the ready signal; pages carry `data-page` and systems `data-system-id`.

## Performance

Measured in the demo on production React (`demo:build`, `demo:preview`), Chrome 156 headless, 1 920 × 1 080, Apple M4 Pro (Mac16,7), 48 GB, macOS 27.2, on the long score with each track's default notation (tab):

| Measure (median of 5, range)       | Paged A4             | Continuous             |
| ---------------------------------- | -------------------- | ---------------------- |
| First paint, total                 | 99.1 ms (92.9–109.1) | 110.8 ms (107.9–111.4) |
| of which `layout()`                | 65.2 ms              | 62.9 ms                |
| of which render and commit         | 19.3 ms              | 22.2 ms                |
| of which the frame                 | 12.2 ms              | 24.5 ms                |
| Edit one note, mid-score, total    | 41.7 ms (35.5–68.9)  | 25.7 ms (18.3–61.0)    |
| of which `layout()` with the cache | 32.4 ms              | 17.8 ms                |
| of which render and commit         | 4.4 ms               | 6.4 ms                 |
| of which the frame                 | 1.4 ms               | 1.8 ms                 |
| Systems whose DOM changed per edit | 1                    | 1                      |

First paint runs from the score being ready to the frame after the commit that mounted its systems; an edit from `applyCommand` to the frame after. "Render and commit" is from handing React the layout to the demo's layout effect, measured with `performance.now()` because `<Profiler>` reports nothing on production React; "frame" is from there to a `setTimeout` after the next `requestAnimationFrame`. The re-layout after a single-note edit on the long score takes 1.6 to 4.6 ms in `pnpm bench` (WP-027), paged or continuous, in any notation; the painter's share (render, commit and frame) is 5.8 ms paged and 8.2 ms continuous. In jsdom, an edit renders the edited system alone (`render-count.test.tsx`).

Auto-scroll moves the region 2 000 px/s for 10 s, recording every frame interval (measured before pages grew to hold their systems):

| Mode       | Zoom | Notation | Frames | Mean fps | p95 interval | Intervals over 20 ms | Mounted elements |
| ---------- | ---- | -------- | ------ | -------- | ------------ | -------------------- | ---------------- |
| paged      | 1    | default  | 601    | 60.1     | 16.8 ms      | 0                    | 5 409            |
| paged      | 1    | both     | 601    | 60.1     | 16.8 ms      | 0                    | 6 451            |
| paged      | 0.5  | default  | 601    | 60.1     | 16.8 ms      | 0                    | 5 410            |
| paged      | 0.5  | both     | 601    | 60.1     | 16.7 ms      | 0                    | 6 400            |
| continuous | 1    | default  | 601    | 60.1     | 16.8 ms      | 0                    | 6 306            |
| continuous | 1    | both     | 601    | 60.1     | 16.8 ms      | 0                    | 7 637            |
| continuous | 0.5  | default  | 601    | 60.1     | 16.7 ms      | 0                    | 8 484            |
| continuous | 0.5  | both     | 601    | 60.1     | 16.8 ms      | 0                    | 11 195           |

`budget.test.ts` asserts the roadmap's element budget in the unit suite, since a count does not vary with load: it bounds the mounted elements of the long score at every zoom, both modes and both notations, at the start, middle and end: at most 2 776 paged and 13 062 continuous against the 20 000 budget. `performance.test.tsx` annotates the jsdom mount and repaint, which are not a browser's costs, and asserts that a repaint after an edit changes only the edited system. The unit tests use a 2-track, 40-bar score, and an 8-track, 6-bar one whose systems split across A4 pages.

Play with following, 10 s from bar 1 on the long score, recorded the same way (Chrome headless 1 920 × 1 080, same machine). In paged mode the view turns a page per system; in continuous mode it glides every frame. The line stayed in view in each run:

| Mode       | Zoom | Frames | Mean fps | p95 interval | Intervals over 20 ms | Mounted elements |
| ---------- | ---- | ------ | -------- | ------------ | -------------------- | ---------------- |
| paged      | 1    | 601    | 60.1     | 16.8 ms      | 0                    | 3 541            |
| paged      | 0.5  | 601    | 60.1     | 16.7 ms      | 0                    | 4 657            |
| continuous | 1    | 601    | 60.1     | 16.7 ms      | 0                    | 5 361            |
| continuous | 0.5  | 601    | 60.1     | 16.7 ms      | 0                    | 7 599            |
