import { note, score, type ScoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { LayoutResult, Primitive } from './index';
import { laid } from './test/effects';
import { sameTick } from './ticks';

/**
 * Seven septuplet 32nds sum to a float short of 960 ticks (the second quarter), so the voice
 * that plays them and one that waits a quarter reach one onset a float apart. `measure` draws it
 * at one x; each comparison of ticks across voices has to agree.
 */
const SEPTUPLET = { tuplet: { n: 7, of: 8 } } as const;

/** A voice 0 whose second quarter starts a float early. */
function drifted(): ScoreBuilder {
  const builder = score()
    .track('guitar', { display: { notation: 'standard', octaveShift: 1 } })
    .bar();
  for (let i = 0; i < 7; i++) builder.beat('32', [note(1, 0)], SEPTUPLET);
  return builder;
}

const glyphs = (result: LayoutResult, name: string): Primitive[] =>
  result.primitives.filter((p) => p.kind === 'glyph' && p.glyph === name);

describe('onsets a float apart are one onset', () => {
  it('the float is real', () => {
    let tick = 0;
    for (let i = 0; i < 7; i++) tick += (960 / 8) * (8 / 7);
    expect(tick).not.toBe(960);
    expect(sameTick(tick, 960)).toBe(true);
  });

  it('keeps accidentals: a split chord makes the next note print its own sign', () => {
    // At the shared onset F natural (voice 0) and F sharp (voice 1) sound together, so memory
    // cannot tell which held and the next F sharp prints its sign again.
    const builder = drifted();
    builder.beat('4', [note(1, 1)]).beat('4', [note(1, 2)]);
    builder
      .voice(1)
      .beat('4', [])
      .beat('4', [note(1, 2)]);
    const built = builder.build({ ids: 'sequential' });
    expect(glyphs(laid(built), 'accidentalSharp')).toHaveLength(2);
  });
});

describe('a bend frame ends at the next onset', () => {
  /** What the bent note draws, with voice 1 resting in `shape`. */
  function bendDrawn(shape: 'together' | 'apart'): string[] {
    const builder = drifted();
    const bent = note(1, 5, {
      bend: {
        kind: 'bend',
        points: [
          { position: 0, value: 0 },
          { position: 60, value: 4 },
        ],
      },
    });
    builder.beat('4', [bent]).beat('4', [note(1, 0)]);
    const voice = builder.voice(1);
    if (shape === 'together') voice.rest('4').rest('4').rest('2');
    else voice.rest('2').rest('2');
    const built = builder.build({ ids: 'sequential' });
    const result = laid(built);
    return result.primitives
      .filter((p) => p.node === bent.id)
      .map((p) => `${p.kind} ${String(p.bbox.x)} ${String(p.bbox.width)}`);
  }

  it('does not count another voice at the same onset as the next one', () => {
    const apart = bendDrawn('apart');
    expect(apart.length).toBeGreaterThan(1);
    expect(bendDrawn('together')).toEqual(apart);
  });
});
