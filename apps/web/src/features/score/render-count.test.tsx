import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import {
  LayoutCache,
  VERTICAL_EDIT_REACH,
  VERTICAL_FOLLOW_UP_REACH,
  anchorBox,
  layout,
  PAGE_SIZES,
  type LayoutOptions,
} from '@reprise/layout';
import { applyCommand, setBeatDuration, setNote, setNoteEffect } from '@reprise/model';
import { beatOf, largeScore } from '@reprise/model/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { primitiveToSvg } from './primitive-svg';
import { ScoreView, type ScoreViewHandle } from './score-view';
import { smallScore } from './test/small-score';
import { stubViewport } from './test/viewport-stub';

vi.mock(import('./primitive-svg'), async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, primitiveToSvg: vi.fn(original.primitiveToSvg) };
});
vi.mock('./fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

const paged: LayoutOptions = {
  mode: 'paged',
  width: PAGE_SIZES.a4.width,
  zoom: 1,
  tracks: 'all',
  notation: {},
};

beforeEach(() => {
  stubViewport(1920, 1080);
});

describe('re-rendering after an edit', () => {
  it('renders the edited system alone, though layout rebuilt its neighbour', () => {
    const score = smallScore();
    const cache = new LayoutCache();
    const before = layout(score, paged, cache);
    const { rerender, container } = render(<ScoreView layout={before} zoom={1} />);
    const mounted = container.querySelectorAll('svg[data-system-id]').length;
    const edited = before.systems[0];
    if (!edited) throw new Error('no system');
    expect(mounted).toBeGreaterThan(2);

    const { score: next, change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 0, edited.bars.start + 1, 0).id }, { string: 1, fret: 5 }),
    );
    const after = layout(next, { ...paged, dirtyBars: change.touchedBars }, cache);
    const rebuilt = after.systems.filter(
      (system, i) =>
        after.primitives[system.primitives.start] !==
        before.primitives[before.systems[i]?.primitives.start ?? -1],
    );
    // Layout rebuilds every system within three bars of the edit; the neighbour comes back as new,
    // equal objects, which the painter must not draw again.
    expect(rebuilt.length).toBeGreaterThanOrEqual(2);
    expect(rebuilt.length).toBeLessThanOrEqual(3);

    const drawn = vi.mocked(primitiveToSvg);
    drawn.mockClear();
    rerender(<ScoreView layout={after} zoom={1} />);

    const { start, end } = after.systems[0]?.primitives ?? { start: 0, end: 0 };
    expect(drawn).toHaveBeenCalledTimes(end - start);
    const rendered = new Set(drawn.mock.calls.map(([primitive]) => primitive));
    expect(rendered).toEqual(new Set(after.primitives.slice(start, end)));
  });

  it('draws only the edited segment when a continuous edit changes a bar width, and moves the later ones', () => {
    const options: LayoutOptions = { ...paged, mode: 'continuous', width: 640 };
    const score = smallScore();
    const cache = new LayoutCache();
    const before = layout(score, options, cache);
    const { rerender, container } = render(<ScoreView layout={before} zoom={1} />);
    const mounted = container.querySelectorAll('svg[data-system-id]').length;
    expect(mounted).toBeGreaterThan(2);

    const { score: next, change } = applyCommand(
      score,
      setBeatDuration({ beatId: beatOf(score, 0, 0, 0).id }, { duration: 16 }),
    );
    const after = layout(next, { ...options, dirtyBars: change.touchedBars }, cache);
    expect(after.systems.map((s) => s.bars)).toEqual(before.systems.map((s) => s.bars));
    expect(after.systems[1]?.offsetX).not.toBe(before.systems[1]?.offsetX);

    const drawn = vi.mocked(primitiveToSvg);
    drawn.mockClear();
    rerender(<ScoreView layout={after} zoom={1} />);

    const { start, end } = after.systems[0]?.primitives ?? { start: 0, end: 0 };
    expect(drawn).toHaveBeenCalledTimes(end - start);
    const rendered = new Set(drawn.mock.calls.map(([primitive]) => primitive));
    expect(rendered).toEqual(new Set(after.primitives.slice(start, end)));

    const svgOf = (id: string) =>
      container.querySelector<SVGElement>(`svg[data-system-id="${id}"]`);
    const later = after.systems.slice(1).filter((system) => svgOf(system.id));
    expect(later.length).toBeGreaterThan(1);
    for (const system of later) {
      const svg = svgOf(system.id);
      expect(svg?.style.left).toBe(`${String(system.bbox.x)}px`);
      expect(svg?.getAttribute('viewBox')?.startsWith('16 ')).toBe(true);
    }
    const second = after.systems[1];
    expect(svgOf(second?.id ?? '')?.style.left).not.toBe(`${String(before.systems[1]?.bbox.x)}px`);
  });

  it('draws only the mounted segments a height-changing continuous edit changed, and nothing again as the rest converge', () => {
    const options: LayoutOptions = { ...paged, mode: 'continuous', width: 640 };
    const score = largeScore(2, 60, { structure: true });
    const cache = new LayoutCache();
    const before = layout(score, options, cache);
    const { rerender, container } = render(<ScoreView layout={before} zoom={1} />);
    const mountedIds = [...container.querySelectorAll('svg[data-system-id]')].map((svg) =>
      svg.getAttribute('data-system-id'),
    );
    expect(mountedIds.length).toBeGreaterThan(1);
    expect(before.systems.length).toBeGreaterThan(mountedIds.length + VERTICAL_EDIT_REACH);

    const note = beatOf(score, 0, 1, 0).notes[0];
    if (!note) throw new Error('no note');
    const { score: next, change } = applyCommand(
      score,
      setNoteEffect({ noteId: note.id }, { letRing: true }),
    );
    const after = layout(
      next,
      { ...options, dirtyBars: change.touchedBars, verticalReach: VERTICAL_EDIT_REACH },
      cache,
    );
    // The premise: the shared vertical layout changed and some segments are stale.
    expect(after.metrics.staleSystems).toBeGreaterThan(0);

    const mounted = after.systems.filter(({ id }) => mountedIds.includes(id));
    // Every mounted segment is drawn with the new vertical layout: none is stale.
    const redrawn = (system: (typeof after.systems)[number], i: number) =>
      after.primitives[system.primitives.start] !==
      before.primitives[before.systems[i]?.primitives.start ?? -1];
    for (const system of mounted) expect(redrawn(system, after.systems.indexOf(system))).toBe(true);

    const drawn = vi.mocked(primitiveToSvg);
    drawn.mockClear();
    rerender(<ScoreView layout={after} zoom={1} />);
    const expected = mounted.reduce(
      (count, { primitives }) => count + primitives.end - primitives.start,
      0,
    );
    expect(drawn).toHaveBeenCalledTimes(expected);

    // Convergence redraws only segments off screen: nothing mounted is drawn again.
    let calls = 0;
    for (let stale = after.metrics.staleSystems; stale > 0; calls += 1) {
      const followed = layout(next, { ...options, verticalReach: VERTICAL_FOLLOW_UP_REACH }, cache);
      expect(followed.metrics.staleSystems).toBeLessThan(stale);
      stale = followed.metrics.staleSystems;
      drawn.mockClear();
      rerender(<ScoreView layout={followed} zoom={1} />);
      expect(drawn).not.toHaveBeenCalled();
    }
    expect(calls).toBeGreaterThan(0);
  });

  it('renders nothing inside a system for a zoom change', () => {
    const result = layout(smallScore(), paged);
    const { rerender } = render(<ScoreView layout={result} zoom={1} />);
    const drawn = vi.mocked(primitiveToSvg);
    drawn.mockClear();
    rerender(<ScoreView layout={result} zoom={2} />);
    expect(drawn).not.toHaveBeenCalled();
  });
});

function layoutBar(result: ReturnType<typeof layout>) {
  const anchor = result.anchors.find((each) => each.kind === 'bar' && each.track === undefined);
  if (!anchor) throw new Error('no bar anchor');
  return { anchor, box: anchorBox(result, anchor) };
}

describe('a child that follows the window', () => {
  it('renders neither the child nor a system again for a scroll, which it hears of at the scroll end', () => {
    const result = layout(smallScore(), paged);
    const handle = createRef<ScoreViewHandle>();
    let renders = 0;
    const Child = () => {
      renders += 1;
      return null;
    };
    const { container } = render(
      <ScoreView ref={handle} layout={result} zoom={1}>
        <Child />
      </ScoreView>,
    );
    const heard = vi.fn();
    const off = handle.current?.subscribeViewport(heard);
    const region = container.querySelector<HTMLElement>('[data-score-view]');
    if (!region) throw new Error('no region');
    const drawn = vi.mocked(primitiveToSvg);
    drawn.mockClear();
    renders = 0;
    heard.mockClear();

    // A few frames inside the mounted set: no render, no listener call.
    for (const top of [4, 8, 12, 16]) {
      region.scrollTop = top;
      fireEvent.scroll(region);
    }
    expect(renders).toBe(0);
    expect(drawn).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();

    // Playhead frames write styles and render nothing.
    const bar = layoutBar(result);
    for (let frame = 0; frame < 5; frame += 1) {
      handle.current?.setPlayhead({ x: bar.box.x + frame * 3, bar: bar.anchor, box: bar.box });
    }
    expect(renders).toBe(0);
    expect(drawn).not.toHaveBeenCalled();
    expect(heard).not.toHaveBeenCalled();

    act(() => {
      region.dispatchEvent(new Event('scrollend'));
    });
    expect(heard).toHaveBeenCalledTimes(1);
    off?.();
    act(() => {
      region.dispatchEvent(new Event('scrollend'));
    });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
