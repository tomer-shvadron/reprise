import { render } from '@testing-library/react';
import { LayoutCache, layout, PAGE_SIZES, type LayoutOptions } from '@reprise/layout';
import { applyCommand, setNote } from '@reprise/model';
import { beatOf } from '@reprise/model/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { primitiveToSvg } from './primitive-svg';
import { ScoreView } from './score-view';
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

  it('renders nothing inside a system for a zoom change', () => {
    const result = layout(smallScore(), paged);
    const { rerender } = render(<ScoreView layout={result} zoom={1} />);
    const drawn = vi.mocked(primitiveToSvg);
    drawn.mockClear();
    rerender(<ScoreView layout={result} zoom={2} />);
    expect(drawn).not.toHaveBeenCalled();
  });
});
