import { act, fireEvent, render, screen } from '@testing-library/react';
import {
  hitTest,
  LayoutCache,
  layout,
  PAGE_SIZES,
  type LayoutOptions,
  type LayoutResult,
} from '@reprise/layout';
import { applyCommand, setNote } from '@reprise/model';
import { beatOf, fullScore, largeScore } from '@reprise/model/testing';
import { createRef, Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { columnAnchor, cursorAt, findAnchors } from './anchors';
import { ScoreView, type ScorePointerEvent, type ScoreViewHandle } from './score-view';
import { pageFlow } from './page-flow';
import { longLayout } from './test/long-score';
import { stubScroll } from './test/scroll-stub';
import { viewLayout } from './test/small-score';
import { stubViewport } from './test/viewport-stub';
import {
  canvasOffset,
  centreFromScroll,
  layoutExtent,
  mountedElementCount,
  mountedPages,
  mountedSystems,
  visibleWindow,
} from './viewport';

const fonts = vi.hoisted(() => ({ ready: true }));
vi.mock('./fonts', () => ({
  useScoreFonts: () => fonts.ready,
  loadScoreFonts: () => Promise.resolve(),
}));

const VIEWPORT = { width: 1920, height: 1080 };
const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

function region(): HTMLElement {
  return screen.getByRole('region', { name: 'Score' });
}

function mountedIds(): string[] {
  return [...region().querySelectorAll('svg[data-system-id]')].map(
    (svg) => svg.getAttribute('data-system-id') ?? '',
  );
}

function canvas(): HTMLElement {
  const found = region().querySelector<HTMLElement>('.score-canvas');
  if (!found) throw new Error('no canvas');
  return found;
}

function svgOf(id: string): SVGSVGElement {
  const found = region().querySelector<SVGSVGElement>(`svg[data-system-id="${id}"]`);
  if (!found) throw new Error(`system ${id} is not mounted`);
  return found;
}

/** Renders, then gives the region a scroll position jsdom can hold. */
function renderView(result: LayoutResult, zoom = 1) {
  const utils = render(<ScoreView layout={result} zoom={zoom} />);
  stubScroll(region());
  return utils;
}

function scrollTo(y: number, x = 0) {
  const element = region();
  element.scrollTop = y;
  element.scrollLeft = x;
  fireEvent.scroll(element);
}

/** What the model expects mounted for a scroll position. */
function expected(result: LayoutResult, zoom: number, scroll?: { x: number; y: number }) {
  const flow = pageFlow(result);
  const offset = canvasOffset(VIEWPORT, layoutExtent(flow), zoom);
  const centre = scroll && centreFromScroll(scroll, VIEWPORT, zoom, offset);
  const window = visibleWindow(centre, VIEWPORT, zoom, offset);
  const range = mountedSystems(flow.systems, window);
  const pages = mountedPages(flow.pages, flow.systems, range, window);
  return { range, pages, window, offset, count: mountedElementCount(result, range, pages) };
}

const small = (notation?: 'both') => viewLayout('small', { mode: 'paged', paper: 'a4' }, notation);

beforeEach(() => {
  fonts.ready = true;
  stubViewport(VIEWPORT.width, VIEWPORT.height);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScoreView', () => {
  it('is a focusable, described score region', () => {
    renderView(layout(fullScore(), paged));
    const view = region();
    expect(view).toHaveAttribute('aria-roledescription', 'score');
    expect(view).toHaveAttribute('tabindex', '0');
    expect(view).toHaveAttribute('aria-busy', 'false');
    expect(view).toHaveAccessibleDescription(/^\d+ bars, 1 page$/);
  });

  it('draws one page box per page and one hidden svg per system', () => {
    const result = layout(fullScore(), paged);
    renderView(result, 1.5);
    expect(region().querySelectorAll('[data-page]')).toHaveLength(result.pages.length);
    for (const system of result.systems) {
      const svg = svgOf(system.id);
      const { x, y, width, height } = system.bbox;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg.getAttribute('viewBox')).toBe(
        `${String(x)} ${String(y)} ${String(width)} ${String(height)}`,
      );
      expect(Number(svg.getAttribute('width'))).toBeCloseTo(width * 1.5);
      expect(svg.children).toHaveLength(system.primitives.end - system.primitives.start);
    }
  });

  it('draws glyphs as Bravura codepoints', () => {
    const result = layout(fullScore(), paged);
    renderView(result);
    const glyphs = result.primitives.filter((p) => p.kind === 'glyph');
    const drawn = region().querySelectorAll('text.score-glyph');
    expect(drawn).toHaveLength(glyphs.length);
    expect([...drawn].map((text) => text.textContent)).toEqual(
      glyphs.map((glyph) => String.fromCodePoint(glyph.codepoint)),
    );
  });

  it('mounts only the systems in view plus one either side', () => {
    const result = small();
    renderView(result);
    const top = expected(result, 1).range;
    expect(top.start).toBe(0);
    expect(top.end).toBeLessThan(6);
    expect(mountedIds()).toEqual(result.systems.slice(top.start, top.end).map(({ id }) => id));

    scrollTo(3500);
    const { range } = expected(result, 1, { x: 0, y: 3500 });
    expect(range.start).toBeGreaterThan(3);
    expect(range.end).toBeLessThan(result.systems.length);
    expect(mountedIds()).toEqual(result.systems.slice(range.start, range.end).map(({ id }) => id));
  });

  it('mounts what is in view after a fast scroll away and back, committing only on a new set', () => {
    const result = longLayout({ mode: 'paged', paper: 'a4' });
    let commits = 0;
    render(
      <Profiler id="view" onRender={() => (commits += 1)}>
        <ScoreView layout={result} zoom={1} />
      </Profiler>,
    );
    stubScroll(region());
    const element = region();
    const scroll = (y: number) => {
      element.scrollTop = y;
      element.dispatchEvent(new Event('scroll', { bubbles: true }));
    };
    const shown = (y: number) => {
      const { range } = expected(result, 1, { x: 0, y });
      return result.systems.slice(range.start, range.end).map(({ id }) => id);
    };
    for (const y of [9000, 12_000, 24_000, 27_000]) {
      act(() => {
        scroll(y);
      });
      // Away into another set and back into this one, before the first transition commits.
      act(() => {
        scroll(y + 2400);
        scroll(y);
      });
      expect(mountedIds(), String(y)).toEqual(shown(y));
    }

    const before = commits;
    act(() => {
      for (let step = 1; step <= 30; step++) scroll(27_000 + step);
    });
    expect(commits).toBe(before);
    expect(mountedIds()).toEqual(shown(27_030));
  });

  it.each([
    ['paged', { mode: 'paged', paper: 'a4' }],
    ['continuous', { mode: 'continuous', paper: 'a4' }],
  ] as const)(
    'keeps the %s both-notation DOM equal to the budget model at zoom 0.5',
    (_, view) => {
      const result = viewLayout('small', view, 'both');
      renderView(result, 0.5);
      const scroll = view.mode === 'paged' ? { x: 0, y: 3000 } : { x: 3000, y: 0 };
      scrollTo(scroll.y, scroll.x);
      const count = region().querySelectorAll('*').length;
      expect(count).toBe(expected(result, 0.5, scroll).count);
      expect(count).toBeLessThan(20_000);
    },
    30_000,
  );

  it('zooms by resizing alone, mutating nothing inside a system', () => {
    const result = small();
    const { rerender } = renderView(result);
    const before = mountedIds();
    const first = result.systems[0];
    if (!first) throw new Error('no system');
    const observer = new MutationObserver(() => undefined);
    observer.observe(region(), {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    rerender(<ScoreView layout={result} zoom={2} />);

    const records = observer.takeRecords();
    observer.disconnect();
    expect(mountedIds()).toEqual(before);
    expect(Number(svgOf(first.id).getAttribute('width'))).toBeCloseTo(first.bbox.width * 2);
    const inside = records.filter(({ target }) => target.parentElement?.closest('svg'));
    expect(inside).toEqual([]);
  });

  it('repaints only the edited system after a cached re-layout', () => {
    const score = largeScore(2, 40);
    const cache = new LayoutCache();
    const before = layout(score, paged, cache);
    const { rerender } = renderView(before);
    const edited = before.systems[1];
    if (!edited) throw new Error('no second system');
    expect(mountedIds()).toContain(edited.id);

    const { score: next, change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 0, edited.bars.start + 1, 0).id }, { string: 1, fret: 5 }),
    );
    const after = layout(next, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(after.systems.map(({ id }) => id)).toEqual(before.systems.map(({ id }) => id));
    const observer = new MutationObserver(() => undefined);
    observer.observe(region(), {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });

    rerender(<ScoreView layout={after} zoom={1} />);

    const records = observer.takeRecords();
    observer.disconnect();
    const svg = svgOf(edited.id);
    expect(records.length).toBeGreaterThan(0);
    expect(records.filter(({ target }) => target !== svg && !svg.contains(target))).toEqual([]);
  });

  it('paints pages but no systems until the fonts are ready', () => {
    fonts.ready = false;
    renderView(layout(fullScore(), paged));
    expect(region()).toHaveAttribute('aria-busy', 'true');
    expect(region().querySelectorAll('[data-page]')).toHaveLength(1);
    expect(mountedIds()).toEqual([]);
  });

  it('reports the anchor under the pointer from layout geometry', () => {
    const result = layout(fullScore(), paged);
    const onScorePointer = vi.fn();
    render(<ScoreView layout={result} zoom={2} onScorePointer={onScorePointer} />);
    const note = result.anchors.find((anchor) => anchor.kind === 'note');
    if (!note) throw new Error('no note anchor');
    const x = note.bbox.x + note.bbox.width / 2;
    const y = note.bbox.y + note.bbox.height / 2;

    fireEvent.pointerDown(canvas(), { clientX: x * 2, clientY: y * 2 });
    expect(onScorePointer).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'down', point: { x, y }, anchor: hitTest(result, x, y) }),
    );
    fireEvent.pointerLeave(canvas(), { clientX: x * 2, clientY: y * 2 });
    expect(onScorePointer).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'leave', anchor: undefined }),
    );
  });

  it('draws the playhead through its handle, and selection, loop and hover from anchors', () => {
    const result = small();
    const notes = result.anchors.filter((anchor) => anchor.kind === 'note');
    const near = notes.find((anchor) => anchor.system === 0);
    const far = notes.find((anchor) => anchor.system === 10);
    if (!near || !far) throw new Error('no note anchors');
    const cursor = cursorAt(result, near);
    if (!cursor) throw new Error('no cursor');
    const ref = createRef<ScoreViewHandle>();
    render(
      <ScoreView
        ref={ref}
        layout={result}
        zoom={2}
        overlays={{ selection: [near, far], loop: [cursor.bar], hover: near }}
      />,
    );
    const layer = region().querySelector('[data-playhead]');
    expect(layer).toHaveAttribute('aria-hidden', 'true');
    const line = () => layer?.querySelector<HTMLElement>('.score-cursor');
    expect(line()?.style.display).toBe('none');
    act(() => {
      ref.current?.setPlayhead(cursor);
    });
    expect(line()?.style.display).toBe('block');
    expect(line()?.dataset['masterBar']).toBe(cursor.bar.id);
    const highlight = layer?.querySelector<HTMLElement>('.score-bar-highlight');
    expect(highlight?.style.transform).toBe(
      `translate(${String(cursor.bar.bbox.x * 2)}px, ${String(cursor.bar.bbox.y * 2)}px)`,
    );
    expect(highlight?.style.height).toBe(`${String(cursor.bar.bbox.height * 2)}px`);
    expect(line()?.style.transform).toBe(
      `translate(${String(cursor.x * 2 - 1)}px, ${String(cursor.bar.bbox.y * 2)}px)`,
    );
    const overlays = region().querySelector('.score-overlays');
    expect(overlays?.querySelectorAll('.score-selection')).toHaveLength(1);
    expect(overlays?.querySelectorAll('.score-loop')).toHaveLength(1);
    expect(overlays?.querySelectorAll('.score-hover')).toHaveLength(1);
    act(() => {
      ref.current?.setPlayhead(undefined);
    });
    expect(line()?.style.display).toBe('none');
    expect(cursor.bar).toBe(columnAnchor(result, near.masterBar ?? '', 0));
    expect(findAnchors(result, near.id)).toContain(near);
  });

  it('reveals a rect by the least scroll and reports the live window', () => {
    const result = small();
    const ref = createRef<ScoreViewHandle>();
    render(<ScoreView layout={result} zoom={1} ref={ref} />);
    stubScroll(region());
    const handle = ref.current;
    if (!handle) throw new Error('no handle');
    const { window } = expected(result, 1);
    expect(handle.viewport()).toEqual(window);

    act(() => {
      handle.revealRect({ x: 100, y: 3000, width: 50, height: 40 }, { margin: 10 });
    });
    const offset = canvasOffset(VIEWPORT, layoutExtent(result), 1);
    expect(region().scrollTop).toBeCloseTo(3050 - VIEWPORT.height + offset.y);
    expect(handle.viewport().y + handle.viewport().height).toBeCloseTo(3050);

    const top = region().scrollTop;
    act(() => {
      handle.revealRect({ x: 100, y: 2500, width: 50, height: 40 });
    });
    expect(region().scrollTop).toBe(top);
  });

  it('grows the paper of a system taller than its page and moves later pages down', () => {
    const result = viewLayout('tall', { mode: 'paged', paper: 'a4' }, 'both');
    const flow = pageFlow(result);
    const onScorePointer = vi.fn<(event: ScorePointerEvent) => void>();
    const notes = result.anchors.filter((anchor) => anchor.kind === 'note');
    const page0 = result.pages[0] ?? never();
    const overflowing = notes.find(
      (anchor) => anchor.system === 0 && anchor.bbox.y > page0.bbox.y + page0.bbox.height,
    );
    const next = notes.find((anchor) => anchor.system === 1);
    if (!overflowing || !next) throw new Error('no note anchors');
    render(
      <ScoreView
        layout={result}
        zoom={1}
        overlays={{ hover: next }}
        onScorePointer={onScorePointer}
      />,
    );

    const shift = flow.shifts[1] ?? 0;
    expect(shift).toBeGreaterThan(0);
    const page1 = region().querySelector<HTMLElement>('[data-page="1"]');
    expect(page1?.style.top).toBe(`${String(flow.pages[1]?.bbox.y)}px`);
    const hover = region().querySelector<HTMLElement>('.score-hover');
    expect(hover?.style.transform).toBe(
      `translate(${String(next.bbox.x)}px, ${String(next.bbox.y + shift)}px)`,
    );

    const centre = (anchor: typeof next, by = 0) => ({
      clientX: anchor.bbox.x + anchor.bbox.width / 2,
      clientY: anchor.bbox.y + anchor.bbox.height / 2 + by,
    });
    const last = (): ScorePointerEvent | undefined => onScorePointer.mock.lastCall?.[0];
    fireEvent.pointerDown(canvas(), centre(overflowing));
    expect(last()?.anchor?.system).toBe(0);
    fireEvent.pointerDown(canvas(), centre(next, shift));
    expect(last()?.point).toEqual({ x: centre(next).clientX, y: centre(next).clientY });
    expect(last()?.anchor?.system).toBe(1);
    fireEvent.pointerCancel(canvas(), centre(next, shift));
    expect(onScorePointer).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'cancel', anchor: undefined }),
    );
  });

  it('carries no colour in an attribute or inline style', () => {
    const result = layout(fullScore(), paged);
    const cursor = cursorAt(result, result.anchors[0] ?? never());
    const ref = createRef<ScoreViewHandle>();
    render(
      <ScoreView
        ref={ref}
        layout={result}
        zoom={1}
        overlays={{ loop: cursor ? [cursor.bar] : [] }}
      />,
    );
    act(() => {
      ref.current?.setPlayhead(cursor);
    });
    for (const element of region().querySelectorAll('*')) {
      for (const name of ['fill', 'stroke']) {
        const value = element.getAttribute(name);
        if (value !== null) expect(['currentColor', 'none']).toContain(value);
      }
      expect(element.getAttribute('color')).toBeNull();
      expect(element.getAttribute('style') ?? '').not.toMatch(
        /colou?r|background|#[0-9a-f]{3}|rgb|oklch/i,
      );
    }
  });
});

function never(): never {
  throw new Error('missing fixture data');
}
