import { anchorBox, layout, type LayoutResult } from '@reprise/layout';
import { describe, expect, it } from 'vitest';

import { barColumns } from '@/features/score';
import { smallScore } from '@/features/score/test/small-score';
import { uniformNotation, viewLayoutOptions } from '@/features/score/view-options';

import { editAnchor, lineAbove, pillAnchor } from './pill-anchor';

function laidOut() {
  const score = smallScore();
  const result = layout(
    score,
    viewLayoutOptions(
      { mode: 'paged', paper: 'a4' },
      { tracks: 'all', notation: uniformNotation(score, 'default') },
    ),
  );
  return { score, result };
}

const idOf = (score: ReturnType<typeof smallScore>, index: number) =>
  score.masterBars[index]?.id ?? '';

describe('pillAnchor', () => {
  it('gives one box per system for a range that crosses a system break', () => {
    const { score, result } = laidOut();
    const [first, second] = result.systems;
    if (!first || !second) throw new Error('two systems expected');
    const range = {
      startBar: idOf(score, first.bars.end - 1),
      endBar: idOf(score, second.bars.start),
    };
    const parts = pillAnchor(result, score, range);
    expect(parts.map((part) => part.system)).toEqual([0, 1]);
    // Each box is the union of that system's columns.
    for (const part of parts) {
      const columns = barColumns(result, score, range)
        .filter((column) => column.system === part.system)
        .map((column) => anchorBox(result, column));
      expect(part.box.x).toBe(Math.min(...columns.map((box) => box.x)));
      expect(part.box.y).toBe(Math.min(...columns.map((box) => box.y)));
    }
  });

  it('gives a single box for bars within one system', () => {
    const { score, result } = laidOut();
    const system = result.systems[0];
    if (!system) throw new Error('no system');
    const parts = pillAnchor(result, score, {
      startBar: idOf(score, system.bars.start),
      endBar: idOf(score, system.bars.end - 1),
    });
    expect(parts).toHaveLength(1);
  });

  it('is empty for a bar the score does not hold', () => {
    const { score, result } = laidOut();
    expect(pillAnchor(result, score, { startBar: 'nope', endBar: 'nope' })).toEqual([]);
  });
});

describe('lineAbove', () => {
  const partOf = (result: LayoutResult, score: ReturnType<typeof smallScore>, system: number) => {
    const found = result.systems[system];
    if (!found) throw new Error('no system');
    const [part] = pillAnchor(result, score, {
      startBar: idOf(score, found.bars.start),
      endBar: idOf(score, found.bars.start),
    });
    if (!part) throw new Error('no part');
    return part;
  };

  it('is the previous system’s staves on the same page', () => {
    const { score, result } = laidOut();
    const [first, second] = result.systems;
    if (!first || !second || first.page !== second.page) throw new Error('same page expected');
    const above = lineAbove(result, partOf(result, score, 1));
    const bottoms = first.staves.map((staff) => staff.bottom);
    expect(above && above.y + above.height).toBe(Math.max(...bottoms));
  });

  it('is nothing for the first system of a page, whatever lies on the page before', () => {
    const { score, result } = laidOut();
    const next = result.systems.findIndex(
      (system, index) => index > 0 && system.page !== result.systems[index - 1]?.page,
    );
    expect(next).toBeGreaterThan(0);
    expect(lineAbove(result, partOf(result, score, next))).toBeUndefined();
  });

  it('is nothing for the first system of the score', () => {
    const { score, result } = laidOut();
    expect(lineAbove(result, partOf(result, score, 0))).toBeUndefined();
  });

  it('finds the other track’s staff in the same system for a box lower in it', () => {
    const { result } = laidOut();
    const system = result.systems[0];
    const [upper, lower] = system?.staves ?? [];
    if (!system || !upper || !lower) throw new Error('two staves expected');
    const box = { x: system.bbox.x, y: lower.top, width: 100, height: lower.bottom - lower.top };
    const above = lineAbove(result, { system: 0, box });
    expect(above && above.y + above.height).toBe(upper.bottom);
  });
});

describe('editAnchor', () => {
  it('widens the caret to the cursor track’s staff band, one box per system', () => {
    const { score, result } = laidOut();
    const track = score.tracks[0]?.id ?? '';
    const system = result.systems[0];
    const band = system?.staves.find((staff) => staff.track === track);
    if (!system || !band) throw new Error('no staff');
    const caret = [{ system: 0, box: { x: 100, y: band.top + 10, width: 2, height: 8 } }];
    const [part] = editAnchor(result, { caret }, track);
    expect(part?.box.x).toBe(100);
    expect(part?.box.width).toBe(2);
    expect(part?.box.y).toBeLessThanOrEqual(band.top);
    expect((part?.box.y ?? 0) + (part?.box.height ?? 0)).toBeGreaterThanOrEqual(band.bottom);
  });

  it('prefers the range’s own boxes, and is empty with neither', () => {
    const { result } = laidOut();
    const range = [{ system: 1, box: { x: 10, y: 20, width: 30, height: 40 } }];
    expect(
      editAnchor(
        result,
        {
          range,
          caret: [{ system: 0, box: range[0]?.box ?? { x: 0, y: 0, width: 1, height: 1 } }],
        },
        'x',
      ),
    ).toEqual(range);
    expect(editAnchor(result, {}, 'x')).toEqual([]);
  });
});
