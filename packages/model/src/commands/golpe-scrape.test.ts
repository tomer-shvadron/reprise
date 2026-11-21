import { describe, expect, it } from 'vitest';

import { GolpeSchema } from '../beat';
import { createHistory } from '../history';
import { PickScrapeSchema } from '../note';
import { validateScore } from '../validate';
import { setBeatEffect, setBeatEffects } from './beat-commands';
import { setNoteEffect, setNoteEffects } from './note-commands';
import { beatOf, buildScore, noteOf, roundTrip } from './test-score';

describe('golpe and pick scrape schemas', () => {
  it.each([
    [GolpeSchema, 'thumb', true],
    [GolpeSchema, 'finger', true],
    [GolpeSchema, 'palm', false],
    [PickScrapeSchema, 'down', true],
    [PickScrapeSchema, 'up', true],
    [PickScrapeSchema, 'left', false],
  ])('%#: %s', (schema, value, ok) => {
    expect(schema.safeParse(value).success).toBe(ok);
  });
});

describe('golpe', () => {
  it('is set and cleared on a beat, singly and batched, and undone', () => {
    const score = buildScore();
    const beatId = beatOf(score, 0, 0, 0).id;
    const { score: set } = roundTrip(
      score,
      setBeatEffect({ beatId }, { effects: { golpe: 'finger' } }),
    );
    expect(beatOf(set, 0, 0, 0).effects.golpe).toBe('finger');
    const { score: cleared } = roundTrip(
      set,
      setBeatEffect({ beatId }, { effects: { golpe: null } }),
    );
    expect(beatOf(cleared, 0, 0, 0).effects).not.toHaveProperty('golpe');

    const history = createHistory();
    const batched = history.apply(
      score,
      setBeatEffects([{ beatId, changes: { effects: { golpe: 'thumb' } } }]),
    );
    expect(beatOf(batched.score, 0, 0, 0).effects.golpe).toBe('thumb');
    expect(validateScore(batched.score)).toEqual([]);
    expect(history.undo()?.score).toEqual(score);
  });
});

describe('pick scrape', () => {
  it('is set and cleared on a note, singly and batched, and undone', () => {
    const score = buildScore();
    const noteId = noteOf(score, 0, 0, 0).id;
    const { score: set } = roundTrip(score, setNoteEffect({ noteId }, { pickScrape: 'up' }));
    expect(noteOf(set, 0, 0, 0).pickScrape).toBe('up');
    const { score: cleared } = roundTrip(set, setNoteEffect({ noteId }, { pickScrape: null }));
    expect(noteOf(cleared, 0, 0, 0)).not.toHaveProperty('pickScrape');

    const history = createHistory();
    const batched = history.apply(
      score,
      setNoteEffects([{ noteId, effects: { pickScrape: 'down' } }]),
    );
    expect(noteOf(batched.score, 0, 0, 0).pickScrape).toBe('down');
    expect(validateScore(batched.score)).toEqual([]);
    expect(history.undo()?.score).toEqual(score);
  });
});
