import { expect } from 'vitest';

import { createHistory } from '../history';
import type { Applied, Command } from '../history';
import type { Score } from '../score';
import { midi, note, score } from '../testing';
import { validateScore } from '../validate';
import { CommandError } from './command-error';
import type { CommandErrorCode } from './command-error';

export { beatOf, noteOf } from '../testing';

/**
 * Four bars of 4/4 at 120 on a guitar and a drum track. Guitar bar 0 opens on string 1 fret 1
 * and ends on string 1 fret 3, tied into bar 1; the guitar carries one lyric line from bar 2.
 */
export function buildScore(): Score {
  return score()
    .tempo(120)
    .track('guitar', { lyrics: [{ startBar: 2, text: 'la la' }] })
    .bar()
    .beat('4', [note(1, 1), note(2, 5)])
    .beat('4', [note(3, 0)])
    .rest('4')
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(1, 3, { tie: true })])
    .beat('4', [note(6, 22)])
    .bar()
    .beat('4', [note(2, 7)])
    .bar()
    .track('drums')
    .bar()
    .beat('4', [midi(36)])
    .build();
}

/**
 * Applies, undoes and redoes `command`, asserting the undone score deep-equals `score`, the
 * redone one the applied one, and that the edit kept every invariant.
 */
export function roundTrip(score: Score, command: Command): Applied {
  const history = createHistory();
  const applied = history.apply(score, command);
  expect(applied.change.patches.length).toBeGreaterThan(0);
  expect(validateScore(applied.score)).toEqual([]);
  expect(history.undo()?.score).toEqual(score);
  expect(history.redo()?.score).toEqual(applied.score);
  return applied;
}

export function expectRefusal(score: Score, command: Command, code: CommandErrorCode): void {
  const history = createHistory();
  let error: unknown;
  try {
    history.apply(score, command);
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(CommandError);
  expect(error).toMatchObject({ code, command: command.name });
  expect(history.canUndo).toBe(false);
}

/**
 * A guitar holding string 2 fret 5 under a melody on string 1: struck in bar 0, tied on the first
 * beat of bar 1 and again on the second beat of bar 2. Bar 3 is empty.
 */
export function buildHeldScore(): Score {
  return score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('4', [note(2, 5)])
    .beat('4', [note(1, 3)])
    .rest('4')
    .beat('4', [note(1, 5)])
    .bar()
    .beat('4', [note(2, 5, { tie: true })])
    .beat('4', [note(1, 7)])
    .beat('4', [note(1, 8)])
    .beat('4', [note(1, 7)])
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 5, { tie: true })])
    .bar()
    .build();
}
