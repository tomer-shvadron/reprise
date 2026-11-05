import { describe, expect, it } from 'vitest';

import { buildHeldScore } from './commands/test-score';
import { beatOf, noteOf } from './testing';
import { tieChainOf, tieOriginOf } from './ties';

describe('tieOriginOf', () => {
  const score = buildHeldScore();
  const guitar = score.tracks[0];
  if (!guitar) throw new Error('no guitar');

  it('finds the most recent note on the string, past melody notes and rests', () => {
    const origin = tieOriginOf(guitar, { bar: 2, voice: 0, beat: 1 }, noteOf(score, 0, 2, 1));
    expect(origin).toEqual({ note: noteOf(score, 0, 1, 0), bar: 1, beat: 0 });
    const first = tieOriginOf(guitar, { bar: 1, voice: 0, beat: 0 }, noteOf(score, 0, 1, 0));
    expect(first).toEqual({ note: noteOf(score, 0, 0, 0), bar: 0, beat: 0 });
  });

  it('finds nothing before the first note on the string', () => {
    expect(tieOriginOf(guitar, { bar: 0, voice: 0, beat: 0 }, noteOf(score, 0, 0, 0))).toBe(
      undefined,
    );
    expect(tieOriginOf(guitar, { bar: 3, voice: 0, beat: 0 }, { string: 6, fret: 0 })).toBe(
      undefined,
    );
  });

  it('is the inverse of tieChainOf', () => {
    const chain = tieChainOf(guitar, { bar: 0, voice: 0, beat: 0 }, noteOf(score, 0, 0, 0));
    expect(chain.map(({ bar, beat }) => [bar, beat])).toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(beatOf(score, 0, 2, 1).notes).toContain(chain[1]?.note);
  });
});
