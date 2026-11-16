import { applyCommand, type Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { must } from './test/must';
import { wordScore } from './test/word-scores';
import { beatWithTrack, planWord, type WordEdit } from './words';

const beats = (score: Score, bar: number) => must(score.tracks[0]?.bars[bar]?.voices[0]?.beats);
const idOf = (score: Score, bar: number, beat: number) => must(beats(score, bar)[beat]).id;

function run(score: Score, edit: WordEdit): { score: Score; notice?: string } {
  const plan = planWord(score, edit);
  if (!('command' in plan)) throw new Error(`no command: ${JSON.stringify(plan)}`);
  const applied = applyCommand(score, plan.command);
  return { score: applied.score, ...(plan.notice && { notice: plan.notice }) };
}

describe('planWord, chord names', () => {
  it('sets a trimmed name and labels the step', () => {
    const score = wordScore();
    const plan = planWord(score, { kind: 'chord', beatId: idOf(score, 0, 1), value: '  G7 ' });
    expect(plan).toMatchObject({ command: { name: 'Chord name' } });
    expect(
      must(
        beats(run(score, { kind: 'chord', beatId: idOf(score, 0, 1), value: ' G7 ' }).score, 0)[1],
      ).chord,
    ).toEqual({ name: 'G7' });
  });

  it('keeps the diagram when the name changes', () => {
    const score = wordScore();
    const { score: next, notice } = run(score, {
      kind: 'chord',
      beatId: idOf(score, 1, 0),
      value: 'Am7',
    });
    const chord = must(beats(next, 1)[0]).chord;
    expect(chord?.name).toBe('Am7');
    expect(chord?.diagram?.frets).toEqual([0, 1, 2, 2, 0, null]);
    expect(notice).toBeUndefined();
  });

  it('removes the chord and its diagram when emptied, with a notice', () => {
    const score = wordScore();
    const { score: next, notice } = run(score, {
      kind: 'chord',
      beatId: idOf(score, 1, 0),
      value: '',
    });
    expect(must(beats(next, 1)[0]).chord).toBeUndefined();
    expect(notice).toBe('Chord diagram removed');
  });

  it('writes nothing for an unchanged or empty value', () => {
    const score = wordScore();
    expect(planWord(score, { kind: 'chord', beatId: idOf(score, 1, 0), value: 'Am' })).toEqual({
      nothing: true,
    });
    expect(planWord(score, { kind: 'chord', beatId: idOf(score, 0, 0), value: ' ' })).toEqual({
      nothing: true,
    });
  });
});

describe('planWord, beat text', () => {
  it('sets and clears the text', () => {
    const score = wordScore();
    const id = idOf(score, 0, 0);
    const set = run(score, { kind: 'text', beatId: id, value: 'rit.' });
    expect(planWord(score, { kind: 'text', beatId: id, value: 'x' })).toMatchObject({
      command: { name: 'Text' },
    });
    expect(must(beats(set.score, 0)[0]).text).toBe('rit.');
    const cleared = run(set.score, { kind: 'text', beatId: id, value: '' });
    expect(must(beats(cleared.score, 0)[0]).text).toBeUndefined();
  });
});

describe('planWord, lyrics', () => {
  it('pads the lines before the written one and drops trailing empties', () => {
    const score = wordScore();
    const id = idOf(score, 0, 0);
    const second = run(score, { kind: 'lyric', beatId: id, line: 2, value: 'la' });
    expect(must(beats(second.score, 0)[0]).lyrics).toEqual(['', '', 'la']);
    const first = run(second.score, { kind: 'lyric', beatId: id, line: 0, value: 'do' });
    expect(must(beats(first.score, 0)[0]).lyrics).toEqual(['do', '', 'la']);
    const emptied = run(first.score, { kind: 'lyric', beatId: id, line: 2, value: '' });
    expect(must(beats(emptied.score, 0)[0]).lyrics).toEqual(['do']);
    const none = run(emptied.score, { kind: 'lyric', beatId: id, line: 0, value: '' });
    expect(must(beats(none.score, 0)[0]).lyrics).toBeUndefined();
  });

  it('clears the raw block once, and only when there is one', async () => {
    const { setTrackProperties } = await import('@reprise/model');
    const score = wordScore();
    const trackId = must(score.tracks[0]).id;
    const raw = applyCommand(
      score,
      setTrackProperties({ trackId }, { lyrics: [{ startBar: 0, text: 'old words' }] }),
    ).score;
    const id = idOf(raw, 0, 0);
    const first = run(raw, { kind: 'lyric', beatId: id, line: 0, value: 'new' });
    expect(must(first.score.tracks[0]).lyrics).toEqual([]);
    expect(planWord(raw, { kind: 'lyric', beatId: id, line: 0, value: 'new' })).toMatchObject({
      command: { name: 'Lyrics' },
    });
    // Nothing changes on a beat that already has the syllable, raw block or not.
    expect(planWord(first.score, { kind: 'lyric', beatId: id, line: 0, value: 'new' })).toEqual({
      nothing: true,
    });
    const plain = run(score, { kind: 'lyric', beatId: id, line: 0, value: 'new' });
    expect(must(plain.score.tracks[0]).lyrics).toEqual([]);
  });

  it('refuses a line past the fifth and a beat that is gone', () => {
    const score = wordScore();
    expect(
      planWord(score, { kind: 'lyric', beatId: idOf(score, 0, 0), line: 5, value: 'x' }),
    ).toHaveProperty('refused');
    expect(planWord(score, { kind: 'chord', beatId: 'nope', value: 'x' })).toHaveProperty(
      'refused',
    );
    expect(beatWithTrack(score, 'nope')).toBeUndefined();
  });
});
