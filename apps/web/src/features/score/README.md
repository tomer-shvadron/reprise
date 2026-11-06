# Score painter

Paints a `LayoutResult` from `@reprise/layout` as SVG (WP-024, ADR-0010). React and CSS only; it reads no store and lays nothing out. The caller computes the layout outside render, with `viewLayoutOptions`, and passes it in.

## API

```tsx
<ScoreView layout={result} zoom={ui.zoom} label={`Score: ${title}`} overlays={...} onScorePointer={...} ref={handle} />
<ScorePages layout={printResult} />
```

| Export                                                                    | What it is                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ScoreView`                                                               | The scrolling score: a focusable `region`, paper for the pages in view or holding a mounted system, SVG only for the systems in view plus one either side, overlays, pointer input.      |
| `ScoreViewHandle`                                                         | `revealRect(rect, { margin?, behavior?, system? })` scrolls the least distance that shows a layout rectangle; `viewport()` is the visible window in layout px.                           |
| `ScorePages`, `ScorePage`                                                 | Every page and system with no virtualization, for printing; `ScorePage` draws `children` inside its page box (a header, a page number) and carries the score tokens, so it paints alone. |
| `viewLayoutOptions(view, content)`                                        | `LayoutOptions` for paged (A4, Letter) or continuous mode, always at zoom 1. `uniformNotation` shows every track in one notation.                                                        |
| `findAnchors`, `columnAnchor`, `cursorAt`, `cursorForBeat`, `anchorIndex` | Anchor lookups by model id, cached per result, and the playback cursor for a note, beat or bar.                                                                                          |
| `loadScoreFonts`, `useScoreFonts`                                         | Bravura and Geist, loaded once; nothing paints before both settle.                                                                                                                       |

`onScorePointer` receives `{ type: 'down' | 'move' | 'up' | 'leave' | 'cancel', point, anchor, event }`: the point in layout px, the anchor `hitTest` finds there (none on `leave` and `cancel`), and the native event for buttons and modifiers. `cancel` ends a drag that gets no `up`.

The app's `ScorePane` (`apps/web/src/app/score-pane.tsx`) mounts `ScoreView` in the score region with the layout store's result, and an empty state until there is one.

```text
ScoreView            region: scroll container, virtualization, zoom anchoring, pointer → hitTest
 └ sizer             scroll extent: canvas × zoom plus a 32 px gutter
    └ canvas         layout (0, 0); the only element with pointer handlers
       ├ ScorePage   paper, positioned at the page-flow page × zoom
       │  └ SystemSvg     one <svg> per mounted system, viewBox = its bbox, keyed by system id, memoized
       │     └ SystemPrimitives   one element per primitive, memoized
       └ OverlayLayer     cursor, bar highlight, selection, hover
```

## Decisions

- **Glyphs are Bravura codepoints in `<text>`**, never paths: `String.fromCodePoint(codepoint)` at `font-size` = `size`, at the glyph origin on its baseline, which is SVG's default text anchoring. Text is Geist at weight 400 with kerning and ligatures off and `white-space: pre`, as layout measured it.
- **Colour is `currentColor` and a role class.** `ink` inherits the system's colour; `paper`, `muted` and `accent` get `score-role-*`, whose `color` is a score token (`--score-ink`, `--score-paper`, …) defined in `score.css` from the theme's paper family in `index.css`. A theme switch is a CSS variable change: no render, no layout. Presentation attributes do not take `var()` reliably, which is why colour goes through `color`. No colour literal appears in the feature (tested).
- **Fonts gate painting.** Bravura loads through `FontFace` from `import.meta.env.BASE_URL`, which is `./` in the Electron build where an absolute `@font-face` URL would miss under `file://`. Geist loads every declared face, one per unicode-range subset, so text outside latin does not reflow later. Until the fonts settle the region is `aria-busy` and only paper is drawn; a failed load warns and paints with a fallback.
- **Virtualization**: the systems whose box meets the visible window, plus one either side; with none in view (a gap between pages), the nearest one and its neighbours. Pages draw their paper for every page that holds a mounted system or meets the window. The rule is mode-agnostic: paged systems stack down, continuous ones run right.
- **One edit re-renders one system.** Systems are keyed by `system.id`, and `SystemSvg` and `SystemPrimitives` are memoized: equal props skip the render. Layout's cache hands reused systems' primitives over by reference, and rebuilds every system after an edited one as new objects with equal values, so the comparison checks identity first and values only where identity fails. `render-count.test.tsx` counts `primitiveToSvg` calls: an edit renders exactly the edited system's primitives, a zoom change none.
- **Paper grows to hold its systems, on screen.** A system taller than its page (eight tracks on A4) overflows into the next page's space until layout breaks it across pages (#85). The view draws that page taller than the paper size and moves every later page down by the growth (`page-flow.ts`), so nothing hides under the next sheet. Overlays, hit-testing, `revealRect` and `viewport()` map between layout px and the moved pages; hit-testing looks only at the page under the pointer, because an overflowing system shares layout y with the next page. Print keeps the paper size.
- **Overlays sit above the notation.** Tab numbers sit on opaque paper knockouts, so a highlight underneath would show as holes; a translucent tint on top colours notes and knockouts alike. They are HTML boxes placed with `transform`, hidden in print.
- **Pointer input is geometry.** Handlers live on the canvas alone and call `hitTest`; systems are `pointer-events: none`, so the browser never hit-tests thousands of SVG nodes.
- **Accessibility**: the scroll container is a `region` named by `label` (default `Score`), `aria-roledescription="score"`, focusable for keyboard scrolling, described by a "300 bars, 100 pages" summary. System SVGs (private-use codepoints) and overlays are `aria-hidden`. `revealRect` scrolls smoothly only when asked and reduced motion is not preferred.
- **Print path**: `ScorePages` plus `score.css`'s print rules (page breaks before every page but the first, no gap, no overlays, no shadow, the paper size). Forcing the light theme while printing and waiting on `loadScoreFonts()` are WP-025's. A system taller than its page does not fit the printed page; WP-025 waits on #85.

### Zoom

Zoom is display only: each system `<svg>` keeps its `viewBox` in layout px and takes `width`/`height` × zoom, and pages and canvas are sized and placed × zoom. Vector-crisp at every zoom, with exact scrollbars, which a CSS transform would not give. A zoom change re-renders sizes only; nothing inside a system changes (tested). The view keeps the layout point at the viewport's centre where it was.

Layout happens at zoom 1 and re-runs only when the width changes (mode, paper). Continuous mode lays out in fixed 640 px segments (`CONTINUOUS_SYSTEM_WIDTH`) rather than at the viewport width: the segments join seamlessly, so their width is invisible, but at zoom 0.5 on a 1 920 px viewport a viewport-wide segment would hold about 9 200 elements and three or four mounted ones would break the 20 000-element budget. With fixed segments the long score stays under 12 600 at every zoom (`budget.test.ts`).

## Demo: `/dev/score`

`pnpm dev`, then `/dev/score` (the dev server serves `apps/web/dev/score.html`). For measurements on production React: `pnpm --filter @reprise/web demo:build && pnpm --filter @reprise/web demo:preview`, then `/dev/score.html`. `vite build` builds `index.html` only, so the demo, the fixtures and `@reprise/model/testing` never reach the app or Electron bundles.

The URL is the demo's whole state:

| Parameter  | Values                                                                                           | Default                    |
| ---------- | ------------------------------------------------------------------------------------------------ | -------------------------- |
| `fixture`  | `long` (the generated 8-track, 300-bar score) or a path under `fixtures/`, e.g. `gp5/staves.gp5` | `long`                     |
| `mode`     | `paged`, `continuous`                                                                            | `paged`                    |
| `paper`    | `a4`, `letter`                                                                                   | `a4`                       |
| `notation` | `default` (each track's own), `tab`, `standard`, `both`                                          | `default`                  |
| `zoom`     | 0.5 to 3                                                                                         | 1                          |
| `theme`    | `dark`, `light`                                                                                  | the stored or system theme |
| `view`     | `scroll` (`ScoreView`), `pages` (`ScorePages`)                                                   | `scroll`                   |

The toolbar edits each, plus **Edit one note** (a `setNote` on the first beat of the first fretted track in the system at the viewport, re-laid out through the cache), **Step cursor** and **Auto-scroll**. Pointer move hovers, pointer down selects and moves the cursor. `aria-busy="false"` on the region is the ready signal; pages carry `data-page` and systems `data-system-id`.

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

First paint runs from the score being ready to the frame after the commit that mounted its systems; an edit from `applyCommand` to the frame after. "Render and commit" is from handing React the layout to the demo's layout effect, measured with `performance.now()` because `<Profiler>` reports nothing on production React; "frame" is from there to a `setTimeout` after the next `requestAnimationFrame`. The re-layout after an edit is WP-027's to bring under 16 ms; the painter's share (render, commit and frame) is 5.8 ms paged and 8.2 ms continuous. In jsdom, an edit renders the edited system alone (`render-count.test.tsx`).

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

`budget.test.ts` asserts the roadmap's element budget in the unit suite, since a count does not vary with load: it bounds the mounted elements of the long score at every zoom, both modes and both notations, at the start, middle and end: at most 6 459 paged and 12 541 continuous against the 20 000 budget. `performance.test.tsx` annotates the jsdom mount and repaint, which are not a browser's costs, and asserts that a repaint after an edit changes only the edited system. The unit tests use a 2-track, 40-bar score, and an 8-track, 6-bar one whose systems are taller than A4.
