import { applyCommand, setNoteEffect, type Score } from '@reprise/model';
import { beatOf, note, noteOf } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, layout, type LayoutResult } from '../../index';
import { stable } from '../../test/check-result';
import { BENDS, guitar, laid, paged } from '../../test/effects';

// A bent note tied onward draws no target heads, so its tie never crosses one (#111, #323).

type Where = 'sameBar' | 'nextBar';

/** A `full` bend on a G, then the same G, tied or not, in the bar or the one after. */
function build(where: Where, tied: boolean, bend = BENDS.full): Score {
  const builder = guitar('standard').bar();
  if (where === 'sameBar') {
    builder
      .beat('8', [note(3, 7, { bend })])
      .beat('8', [note(3, 7, tied ? { tie: true } : {})])
      .beat('4', [note(3, 5)])
      .beat('2', [note(3, 5)])
      .bar()
      .beat('1', [note(3, 5)]);
  } else {
    builder
      .beat('2', [note(3, 5)])
      .beat('4', [note(3, 5)])
      .beat('4', [note(3, 7, { bend })])
      .bar()
      .beat('4', [note(3, 7, tied ? { tie: true } : {})])
      .beat('2', [note(3, 5)])
      .beat('4', [note(3, 5)]);
  }
  return builder.build({ ids: 'sequential' });
}

const bentId = (where: Where, built: Score): string =>
  where === 'sameBar' ? noteOf(built, 0, 0, 0, 0).id : noteOf(built, 0, 0, 2, 0).id;

/** The grace-size heads drawn for a note: smaller than its main head. */
function targetHeads(result: LayoutResult, node: string) {
  const heads = result.primitives.filter(
    (p) => p.kind === 'glyph' && p.glyph === 'noteheadBlack' && p.node === node,
  );
  const main = Math.max(...heads.map((p) => (p.kind === 'glyph' ? p.size : 0)));
  return heads.filter((p) => p.kind === 'glyph' && p.size < main);
}

describe('bend target heads on a note tied onward', () => {
  it.each(['sameBar', 'nextBar'] as const)(
    'draws none when the tie leaves the bent note, %s, and still draws them untied',
    (where) => {
      const tied = build(where, true);
      const untied = build(where, false);
      expect(targetHeads(laid(tied), bentId(where, tied))).toHaveLength(0);
      expect(targetHeads(laid(untied), bentId(where, untied))).toHaveLength(1);
    },
  );

  it.each(['sameBar', 'nextBar'] as const)(
    'draws the tie whole, past the main head only, %s',
    (where) => {
      const built = build(where, true);
      const result = laid(built);
      const id = bentId(where, built);
      const tiedId =
        where === 'sameBar' ? noteOf(built, 0, 0, 1, 0).id : noteOf(built, 0, 1, 0, 0).id;
      const main = result.primitives.find((p) => p.kind === 'glyph' && p.node === id);
      const tie = result.primitives.find(
        (p) => p.kind === 'path' && p.fill && p.d.includes('C') && p.node === tiedId,
      );
      if (!main || !tie) throw new Error('missing main head or tie');
      expect(tie.bbox.x).toBeGreaterThanOrEqual(main.bbox.x + main.bbox.width);
    },
  );

  it('reserves no target room before the tie: the tied onset is no wider than a plain bent one', () => {
    const gap = (built: Score): number => {
      const result = layout(built, paged);
      const x = (beat: number): number =>
        result.anchors.find((a) => a.kind === 'beat' && a.id === beatOf(built, 0, 0, beat).id)?.bbox
          .x ?? NaN;
      return x(1) - x(0);
    };
    expect(gap(build('sameBar', true))).toBeLessThan(gap(build('sameBar', false)));
  });

  it('measures the bar before afresh when the next bar gains or loses the tie', () => {
    const before = build('nextBar', false);
    const cache = new LayoutCache();
    layout(before, paged, cache);
    const { score: after, change } = applyCommand(
      before,
      setNoteEffect({ noteId: noteOf(before, 0, 1, 0).id }, { tie: true }),
    );
    const cached = layout(after, { ...paged, dirtyBars: change.touchedBars }, cache);
    expect(stable(cached)).toBe(stable(layout(after, paged)));
    const restored = applyCommand(
      after,
      setNoteEffect({ noteId: noteOf(after, 0, 1, 0).id }, { tie: false }),
    );
    const back = layout(
      restored.score,
      { ...paged, dirtyBars: restored.change.touchedBars },
      cache,
    );
    expect(stable(back)).toBe(stable(layout(restored.score, paged)));
    expect(targetHeads(back, bentId('nextBar', restored.score))).toHaveLength(1);
  });
});
