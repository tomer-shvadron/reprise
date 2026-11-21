import { describe, expect, it } from 'vitest';

import { WahSchema } from '../beat';
import { createHistory } from '../history';
import { parseNative, serializeNative } from '../native';
import { validateScore } from '../validate';
import { setBeatEffect, setBeatEffects } from './beat-commands';
import { beatOf, buildScore, roundTrip } from './test-score';

describe('wah schema', () => {
  it.each([
    ['open', true],
    ['closed', true],
    ['off', false],
    ['half', false],
  ])('%s', (value, ok) => {
    expect(WahSchema.safeParse(value).success).toBe(ok);
  });
});

describe('wah', () => {
  it('is set and cleared on a beat, singly and batched, and undone', () => {
    const score = buildScore();
    const beatId = beatOf(score, 0, 0, 0).id;
    const { score: set } = roundTrip(
      score,
      setBeatEffect({ beatId }, { effects: { wah: 'open' } }),
    );
    expect(beatOf(set, 0, 0, 0).effects.wah).toBe('open');
    const { score: cleared } = roundTrip(
      set,
      setBeatEffect({ beatId }, { effects: { wah: null } }),
    );
    expect(beatOf(cleared, 0, 0, 0).effects).not.toHaveProperty('wah');

    const history = createHistory();
    const batched = history.apply(
      score,
      setBeatEffects([{ beatId, changes: { effects: { wah: 'closed' } } }]),
    );
    expect(beatOf(batched.score, 0, 0, 0).effects.wah).toBe('closed');
    expect(validateScore(batched.score)).toEqual([]);
    expect(history.undo()?.score).toEqual(score);
  });

  it('is valid on a rest and survives the native format', () => {
    const score = buildScore();
    const rest = beatOf(score, 0, 0, 2);
    expect(rest.rest).toBe(true);
    const { score: after } = roundTrip(
      score,
      setBeatEffect({ beatId: rest.id }, { effects: { wah: 'closed' } }),
    );
    expect(beatOf(after, 0, 0, 2)).toMatchObject({ rest: true, effects: { wah: 'closed' } });
    expect(validateScore(after)).toEqual([]);
    const bytes = serializeNative(after, { name: 'Reprise', version: '0.0.0' });
    expect(parseNative(bytes).score).toEqual(after);
  });
});
