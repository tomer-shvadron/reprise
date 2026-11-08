import { act, fireEvent, render, screen } from '@testing-library/react';
import { Profiler, createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cursorAt, type PlaybackCursor } from './anchors';
import { primitiveToSvg } from './primitive-svg';
import { ScoreView, type ScorePointerEvent, type ScoreViewHandle } from './score-view';
import { FOLLOW_MARGIN } from './follow';
import { stubScroll } from './test/scroll-stub';
import { viewLayout } from './test/small-score';
import { stubViewport } from './test/viewport-stub';

vi.mock(import('./primitive-svg'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, primitiveToSvg: vi.fn(original.primitiveToSvg) };
});
vi.mock('./fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

const VIEWPORT = { width: 1280, height: 800 };
const paged = () => viewLayout('small', { mode: 'paged', paper: 'a4' });
const continuous = () => viewLayout('small', { mode: 'continuous', paper: 'a4' });

function region(): HTMLElement {
  return screen.getByRole('region', { name: 'Score' });
}

function canvas(): HTMLElement {
  const found = region().querySelector<HTMLElement>('.score-canvas');
  if (!found) throw new Error('no canvas');
  return found;
}

function line(): HTMLElement {
  const found = region().querySelector<HTMLElement>('.score-cursor');
  if (!found) throw new Error('no line');
  return found;
}

/** The cursor at the first beat of each master bar's first staff, in order. */
function barCursors(result: ReturnType<typeof paged>): PlaybackCursor[] {
  const seen = new Set<string>();
  const cursors: PlaybackCursor[] = [];
  for (const anchor of result.anchors) {
    if (anchor.kind !== 'beat' || anchor.masterBar === undefined || seen.has(anchor.masterBar)) {
      continue;
    }
    seen.add(anchor.masterBar);
    const cursor = cursorAt(result, anchor);
    if (cursor) cursors.push(cursor);
  }
  return cursors;
}

const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTo');

beforeEach(() => {
  stubViewport(VIEWPORT.width, VIEWPORT.height);
  // jsdom does not scroll: land at once, as reduced motion would.
  Element.prototype.scrollTo = function scrollTo(
    this: Element,
    options?: ScrollToOptions | number,
  ) {
    if (typeof options !== 'object') return;
    if (options.left !== undefined) this.scrollLeft = options.left;
    if (options.top !== undefined) this.scrollTop = options.top;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  if (originalScrollTo) Object.defineProperty(Element.prototype, 'scrollTo', originalScrollTo);
});

describe('the playhead', () => {
  it('moves through its handle with no React commit and no system render', () => {
    const result = paged();
    const ref = createRef<ScoreViewHandle>();
    const commits = vi.fn();
    render(
      <Profiler id="view" onRender={commits}>
        <ScoreView ref={ref} layout={result} zoom={1} />
      </Profiler>,
    );
    commits.mockClear();
    vi.mocked(primitiveToSvg).mockClear();
    const cursors = barCursors(result);
    const transforms = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const cursor = cursors[i % cursors.length];
      ref.current?.setPlayhead(cursor && { ...cursor, x: cursor.x + (i % 7) });
      transforms.add(line().style.transform);
    }
    expect(transforms.size).toBeGreaterThan(50);
    expect(commits).not.toHaveBeenCalled();
    expect(primitiveToSvg).not.toHaveBeenCalled();
  });

  it('repaints at a new zoom', () => {
    const result = paged();
    const ref = createRef<ScoreViewHandle>();
    const { rerender } = render(<ScoreView ref={ref} layout={result} zoom={1} />);
    const [cursor] = barCursors(result);
    if (!cursor) throw new Error('no cursor');
    act(() => {
      ref.current?.setPlayhead(cursor);
    });
    rerender(<ScoreView ref={ref} layout={result} zoom={2} />);
    expect(line().style.transform).toBe(
      `translate(${String(cursor.x * 2 - 1)}px, ${String(cursor.box.y * 2)}px)`,
    );
  });
});

describe('following', () => {
  function setup(mode: 'paged' | 'continuous' = 'paged') {
    const result = mode === 'paged' ? paged() : continuous();
    const ref = createRef<ScoreViewHandle>();
    render(<ScoreView ref={ref} layout={result} zoom={1} />);
    stubScroll(region());
    const handle = ref.current;
    if (!handle) throw new Error('no handle');
    const show = (cursor: PlaybackCursor | undefined, running = true, force = false) => {
      act(() => {
        handle.setPlayhead(cursor);
        handle.followPlayhead({
          mode,
          running,
          force,
        });
      });
    };
    return { handle, show, cursors: barCursors(result), result };
  }

  it('turns the page when the next system is not fully in view, and only then', () => {
    const { handle, show, cursors, result } = setup();
    const systemOf = (cursor: PlaybackCursor) => result.systems[cursor.bar.system];
    for (const cursor of cursors.slice(0, 12)) {
      show(cursor);
      const window = handle.viewport();
      expect(cursor.x).toBeGreaterThanOrEqual(window.x);
      const system = systemOf(cursor);
      if (!system) throw new Error('no system');
      expect(system.bbox.y).toBeGreaterThanOrEqual(window.y - 0.5);
      expect(system.bbox.y + system.bbox.height).toBeLessThanOrEqual(
        window.y + window.height + 0.5,
      );
    }
    expect(region().scrollTop).toBeGreaterThan(0);
    const top = region().scrollTop;
    const current = cursors[11];
    if (!current) throw new Error('no cursor');
    show(current);
    expect(region().scrollTop).toBe(top);
  });

  it('reveals on request while stopped, and jumps back to a system off screen', () => {
    const { handle, show, cursors, result } = setup();
    const late = cursors.at(-1);
    const first = cursors[0];
    if (!late || !first) throw new Error('no cursors');
    show(late, false);
    const lateSystem = result.systems[late.bar.system];
    if (!lateSystem) throw new Error('no system');
    const window = handle.viewport();
    expect(lateSystem.bbox.y).toBeGreaterThanOrEqual(window.y);
    expect(lateSystem.bbox.y + lateSystem.bbox.height).toBeLessThanOrEqual(
      window.y + window.height,
    );

    show(first, true, true);
    expect(handle.viewport().y).toBeCloseTo((result.systems[0]?.bbox.y ?? 0) - FOLLOW_MARGIN, 0);
  });

  it('glides in continuous mode, keeping the line in view', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { handle, show, cursors } = setup('continuous');
    for (const cursor of cursors) {
      now += 100;
      show(cursor);
      const window = handle.viewport();
      expect(cursor.x).toBeGreaterThanOrEqual(window.x);
      expect(cursor.x).toBeLessThanOrEqual(window.x + window.width);
    }
    expect(region().scrollLeft).toBeGreaterThan(0);
    expect(region().scrollTop).toBe(0);
  });
});

describe('a smooth scroll in flight', () => {
  /** Smooth calls only record their destination, as a browser's would mid-flight; instant writes land. */
  function setup(mode: 'paged' | 'continuous') {
    const smooth: ScrollToOptions[] = [];
    Element.prototype.scrollTo = function scrollTo(options?: ScrollToOptions | number) {
      if (typeof options === 'object' && options.behavior === 'smooth') smooth.push(options);
    };
    const result = mode === 'paged' ? paged() : continuous();
    const ref = createRef<ScoreViewHandle>();
    const view = () => <ScoreView ref={ref} layout={result} zoom={1} />;
    const { rerender } = render(view());
    stubScroll(region());
    const handle = ref.current;
    if (!handle) throw new Error('no handle');
    const seek = (cursor: PlaybackCursor | undefined) => {
      act(() => {
        handle.setPlayhead(cursor);
        handle.followPlayhead({ mode, running: false, force: true });
      });
    };
    const resize = (width: number, height: number) => {
      stubViewport(width, height);
      rerender(view());
    };
    return {
      smooth,
      seek,
      resize,
      cursors: barCursors(result),
      result,
      handle,
    };
  }

  const frame = () =>
    act(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
    );

  it('is retargeted by a seek the window shows only because the scroll has not moved yet', () => {
    const { smooth, seek, cursors, result, handle } = setup('paged');
    const first = cursors[0];
    const late = cursors.at(-1);
    if (!first || !late) throw new Error('no cursors');
    seek(late);
    expect(smooth).toHaveLength(1);
    expect(region().scrollTop).toBe(0);

    // Bar 1 shows from where the view still is, but not from where it is going.
    seek(first);
    expect(smooth).toHaveLength(2);
    expect(region()).toHaveAttribute('data-scrolling');
    region().scrollTop = smooth[1]?.top ?? Number.NaN;
    fireEvent.scroll(region());
    // One frame at the destination may be a retarget passing it.
    expect(region()).toHaveAttribute('data-scrolling');
    fireEvent.scroll(region());
    expect(region()).not.toHaveAttribute('data-scrolling');
    expect(handle.viewport().y).toBeCloseTo((result.systems[0]?.bbox.y ?? 0) - FOLLOW_MARGIN, 0);
  });

  it('is left alone by a seek its destination already shows', () => {
    const { smooth, seek, cursors } = setup('paged');
    const late = cursors.at(-1);
    // The system above the late one: a reveal from above leaves the late system at the bottom.
    const above = cursors.filter((cursor) => cursor.bar.system === (late?.bar.system ?? 0) - 1);
    const neighbour = above.at(-1);
    if (!late || !neighbour) throw new Error('no cursors');
    seek(late);
    seek(neighbour);
    expect(smooth).toHaveLength(1);
  });

  it('survives a wheel, which does not stop it, and a short scrollend while it still moves', async () => {
    const { smooth, seek, cursors } = setup('paged');
    const late = cursors.at(-1);
    if (!late) throw new Error('no cursors');
    seek(late);
    expect(region()).toHaveAttribute('data-scrolling');
    fireEvent.wheel(region(), { deltaY: -100 });
    expect(region()).toHaveAttribute('data-scrolling');

    // The wheel's own scroll ends, and the view's carries on toward its destination.
    region().scrollTop = 10;
    fireEvent(region(), new Event('scrollend'));
    region().scrollTop = 30;
    await frame();
    await frame();
    await frame();
    expect(region()).toHaveAttribute('data-scrolling');
    expect(smooth).toHaveLength(1);
  });

  it('ends with a short scrollend and no motion after, then seeks use the live position', async () => {
    const { smooth, seek, cursors } = setup('paged');
    const first = cursors[0];
    const late = cursors.at(-1);
    if (!first || !late) throw new Error('no cursors');
    seek(late);
    // A key replaced the view's scroll and stopped short.
    region().scrollTop = 10;
    fireEvent(region(), new Event('scrollend'));
    expect(region()).toHaveAttribute('data-scrolling');
    await frame();
    await frame();
    await frame();
    expect(region()).not.toHaveAttribute('data-scrolling');
    seek(first);
    expect(smooth).toHaveLength(1);
  });

  it('keeps its destination through a viewport change, which does not stop it', () => {
    const { smooth, seek, resize, cursors } = setup('paged');
    const first = cursors[0];
    const late = cursors.at(-1);
    if (!first || !late) throw new Error('no cursors');
    seek(late);
    resize(VIEWPORT.width, VIEWPORT.height - 200);
    expect(region()).toHaveAttribute('data-scrolling');
    seek(first);
    expect(smooth).toHaveLength(2);
  });

  it('is retargeted on x in continuous view', () => {
    const { smooth, seek, cursors } = setup('continuous');
    const first = cursors[0];
    const late = cursors.at(-1);
    if (!first || !late) throw new Error('no cursors');
    seek(late);
    seek(first);
    expect(smooth).toHaveLength(2);
    expect(smooth[1]?.left).toBeLessThan(smooth[0]?.left ?? 0);
  });
});

describe('hand scrolls', () => {
  it('are told from input: the wheel, a scrollbar press and keys no command took', () => {
    vi.useFakeTimers();
    try {
      const onUserScroll = vi.fn();
      render(<ScoreView layout={paged()} zoom={1} onUserScroll={onUserScroll} />);
      fireEvent.wheel(region(), { deltaY: 100 });
      expect(onUserScroll).toHaveBeenLastCalledWith('y');
      fireEvent.wheel(region(), { deltaY: 100, shiftKey: true });
      expect(onUserScroll).toHaveBeenLastCalledWith('x');
      onUserScroll.mockClear();
      fireEvent.wheel(region(), { deltaY: 100, ctrlKey: true });
      expect(onUserScroll).not.toHaveBeenCalled();

      fireEvent.keyDown(region(), { key: 'PageDown' });
      expect(onUserScroll).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(onUserScroll).toHaveBeenLastCalledWith('y');
      onUserScroll.mockClear();
      const taken = new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      });
      region().dispatchEvent(taken);
      taken.preventDefault();
      vi.runAllTimers();
      expect(onUserScroll).not.toHaveBeenCalled();

      fireEvent.pointerDown(region(), { button: 1 });
      expect(onUserScroll).toHaveBeenLastCalledWith('both');
      onUserScroll.mockClear();
      fireEvent.pointerDown(canvas(), { button: 0 });
      expect(onUserScroll).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pointer columns', () => {
  it('name the nearest bar column, also between systems', () => {
    const result = paged();
    const onScorePointer = vi.fn<(event: ScorePointerEvent) => void>();
    render(<ScoreView layout={result} zoom={1} onScorePointer={onScorePointer} />);
    const [s0, s1] = result.systems;
    if (!s0 || !s1) throw new Error('no systems');
    const gapY = s0.bbox.y + s0.bbox.height + (s1.bbox.y - s0.bbox.y - s0.bbox.height) * 0.8;
    fireEvent.pointerDown(canvas(), { clientX: s1.bbox.x + 5, clientY: gapY });
    const event = onScorePointer.mock.lastCall?.[0];
    expect(event?.anchor).toBeUndefined();
    expect(event?.column?.system).toBe(1);
    fireEvent.pointerLeave(canvas(), { clientX: 0, clientY: 0 });
    expect(onScorePointer.mock.lastCall?.[0].column).toBeUndefined();
  });
});
