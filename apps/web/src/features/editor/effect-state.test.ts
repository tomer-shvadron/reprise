import { beatOf, note, noteOf, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { effectState } from './effect-state';
import type { EffectAction } from './effects';

const built = score()
  .track('guitar')
  .bar()
  .beat('4', [note(1, 5, { palmMute: true })])
  .beat('4', [note(2, 7, { palmMute: true })])
  .beat('4', [note(3, 2)], { effects: { tapping: true } })
  .rest('4')
  .build();

const palmMute: EffectAction = { kind: 'flag', flag: 'palmMute' };
const at = (...beats: number[]) => ({
  score: built,
  state: {
    cursor: undefined,
    range: undefined,
    selection: { noteIds: beats.map((beat) => noteOf(built, 0, 0, beat).id) },
  },
});

describe('effectState', () => {
  it('is on when every note has it, off when none does, mixed between', () => {
    expect(effectState(at(0, 1), palmMute)).toBe('on');
    expect(effectState(at(2), palmMute)).toBe('off');
    expect(effectState(at(0, 2), palmMute)).toBe('mixed');
  });

  it('reads a beat effect from the beats of the notes', () => {
    expect(effectState(at(2), { kind: 'beatFlag', flag: 'tapping' })).toBe('on');
    expect(effectState(at(1, 2), { kind: 'beatFlag', flag: 'tapping' })).toBe('mixed');
  });

  it('is unavailable with nothing to act on', () => {
    const rest = {
      score: built,
      state: {
        cursor: undefined,
        range: undefined,
        selection: { beatIds: [beatOf(built, 0, 0, 3).id] },
      },
    };
    expect(effectState(rest, palmMute)).toBe('unavailable');
    expect(effectState({ ...rest, state: { ...rest.state, selection: {} } }, palmMute)).toBe(
      'unavailable',
    );
  });
});
