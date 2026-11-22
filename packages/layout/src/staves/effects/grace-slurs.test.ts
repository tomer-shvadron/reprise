import { type Score } from '@reprise/model';
import { note, noteOf, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { LayoutCache, layout, type LayoutResult, type Primitive } from '../../index';
import { stable, strayPrimitives } from '../../test/check-result';
import { describePrimitive } from '../../test/describe';
import { guitar, laid, paged, texts } from '../../test/effects';

type Notation = 'tab' | 'standard' | 'both';

const arcsOf = (result: LayoutResult, node: string): Primitive[] =>
  result.primitives.filter(
    (p) => p.kind === 'path' && p.fill && p.d.includes('C') && p.node === node,
  );

const letters = (result: LayoutResult): string[] => texts(result).filter((t) => /^[HP]$/.test(t));

/** Two grace notes on string 2, the second hammered, then a main note. */
function twoGraces(notation: Notation, first: number, second: number): ScoreBuilder {
  return guitar(notation)
    .bar()
    .beat('4', [note(2, 7)], {
      grace: [
        { duration: 32, before: true, notes: [note(2, first)] },
        { duration: 32, before: true, notes: [note(2, second, { hammerPull: true })] },
      ],
    })
    .beat('2.', [note(2, 7)]);
}

function graceTarget(built: Score): string {
  const grace = built.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.grace?.[1]?.notes[0];
  if (!grace) throw new Error('no grace note');
  return grace.id;
}

describe('hammer-ons and pull-offs between grace notes (#160)', () => {
  it.each<Notation>(['tab', 'standard', 'both'])(
    'draws one arc for a hammered second grace note in %s',
    (notation) => {
      const built = twoGraces(notation, 5, 7).build({ ids: 'sequential' });
      const result = laid(built);
      expect(strayPrimitives(result, built).map(describePrimitive)).toEqual([]);
      // Both mode shows the slur on the standard staff and the arc on the tab: one each.
      expect(arcsOf(result, graceTarget(built))).toHaveLength(notation === 'both' ? 2 : 1);
      expect(letters(result)).toEqual(['H']);
    },
  );

  it.each<Notation>(['tab', 'standard'])('letters a pull-off P in %s', (notation) => {
    const built = twoGraces(notation, 7, 5).build({ ids: 'sequential' });
    const result = laid(built);
    expect(arcsOf(result, graceTarget(built))).toHaveLength(1);
    expect(letters(result)).toEqual(['P']);
  });

  it.each<Notation>(['tab', 'standard', 'both'])(
    'draws nothing when the second grace note is not hammered, in %s',
    (notation) => {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(2, 7)], {
          grace: [
            { duration: 32, before: true, notes: [note(2, 5)] },
            { duration: 32, before: true, notes: [note(2, 7)] },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      expect(arcsOf(result, graceTarget(built))).toHaveLength(0);
      expect(letters(result)).toEqual([]);
    },
  );

  it.each<Notation>(['tab', 'standard', 'both'])(
    'finds a main note’s origin across a later grace column on another string, in %s',
    (notation) => {
      const built = guitar(notation)
        .bar()
        .beat('4', [note(2, 7, { hammerPull: true })], {
          grace: [
            { duration: 32, before: true, notes: [note(2, 5)] },
            { duration: 32, before: true, notes: [note(4, 5)] },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' });
      const result = laid(built);
      expect(arcsOf(result, noteOf(built, 0, 0, 0).id).length).toBeGreaterThan(0);
      expect(letters(result)).toEqual(['H']);
    },
  );

  it('keeps the grace columns of a link apart so the arc has a body', () => {
    const plain = laid(
      guitar('tab')
        .bar()
        .beat('4', [note(2, 7)], {
          grace: [
            { duration: 32, before: true, notes: [note(2, 5)] },
            { duration: 32, before: true, notes: [note(2, 7)] },
          ],
        })
        .beat('2.', [note(2, 7)])
        .build({ ids: 'sequential' }),
    );
    const linkedScore = twoGraces('tab', 5, 7).build({ ids: 'sequential' });
    const linked = laid(linkedScore);
    const arc = arcsOf(linked, graceTarget(linkedScore))[0];
    expect(arc && arc.bbox.width).toBeGreaterThan(5);
    expect(plain.primitives.length).toBeGreaterThan(0);
  });

  it.each<Notation>(['tab', 'standard', 'both'])(
    'lays a cached bar out as a cold one, in %s',
    (notation) => {
      const built = twoGraces(notation, 5, 7).build({ ids: 'sequential' });
      const cache = new LayoutCache();
      layout(built, paged, cache);
      expect(stable(layout(built, paged, cache))).toBe(stable(layout(built, paged)));
    },
  );
});
