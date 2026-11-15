import { describe, expect, it } from 'vitest';

import { applyCommand, createHistory } from '../history';
import type { Command } from '../history';
import { CommandError } from './command-error';
import { newId } from '../id';
import type { Score } from '../score';
import { largeScore } from '../testing';
import { validateScore } from '../validate';
import { insertBar, removeBar, setMasterBar, setMasterBars } from './bar-commands';
import { insertBeat } from './beat-commands';
import { setNote } from './note-commands';
import { chain } from './chain';
import { beatOf, buildScore, expectRefusal } from './test-score';

const voiceId = (score: Score, bar: number): string => {
  const voice = score.tracks[0]?.bars[bar]?.voices[0];
  if (!voice) throw new Error('no voice');
  return voice.id;
};
const masterBarId = (score: Score, index: number): string => {
  const found = score.masterBars[index];
  if (!found) throw new Error('no master bar');
  return found.id;
};

describe('chain', () => {
  it('lets a step name a beat an earlier step created', () => {
    const score = buildScore();
    const id = newId();
    const history = createHistory();
    const { score: after } = history.apply(
      score,
      chain('Add note', [
        insertBeat({ voiceId: voiceId(score, 2), index: 0, id }),
        setNote({ beatId: id }, { string: 3, fret: 4 }),
      ]),
    );
    expect(beatOf(after, 0, 2, 0)).toMatchObject({ id, rest: false });
    expect(beatOf(after, 0, 2, 0).notes).toMatchObject([{ string: 3, fret: 4 }]);
    expect(validateScore(after)).toEqual([]);
    // Without the chain the same two commands share one draft and the locator misses the beat.
    expect(() =>
      applyCommand(score, {
        name: 'shared draft',
        run(draft, warn) {
          insertBeat({ voiceId: voiceId(score, 2), index: 0, id }).run(draft, warn);
          setNote({ beatId: id }, { string: 3, fret: 4 }).run(draft, warn);
        },
      }),
    ).toThrow(/no beat/);
  });

  it('removes exactly the bars it names when two removeBar steps follow each other', () => {
    const score = buildScore();
    const [m0, m1, m2, m3] = score.masterBars.map((bar) => bar.id);
    const { score: after } = applyCommand(
      score,
      chain('Remove bars', [
        removeBar({ masterBarId: masterBarId(score, 2) }),
        removeBar({ masterBarId: masterBarId(score, 3) }),
      ]),
    );
    expect(after.masterBars.map((bar) => bar.id)).toEqual([m0, m1]);
    expect(m2).toBeDefined();
    expect(m3).toBeDefined();
    expect(after.tracks.every((track) => track.bars.length === 2)).toBe(true);
    expect(validateScore(after)).toEqual([]);
  });

  it('is atomic: a refusal in a later step leaves the score and the history untouched', () => {
    const score = buildScore();
    const command = chain('Broken', [
      removeBar({ masterBarId: masterBarId(score, 3) }),
      removeBar({ masterBarId: 'missing' }),
    ]);
    const history = createHistory();
    expect(() => history.apply(score, command)).toThrow(CommandError);
    expect(history.canUndo).toBe(false);
    expect(score.masterBars).toHaveLength(4);
  });

  it('resolves a function step against the score the previous step produced', () => {
    const score = buildScore();
    const beatId = newId();
    const { score: after } = applyCommand(
      score,
      chain('Bar with a note', [
        insertBar({ index: 1 }),
        (current) => {
          const voice = current.tracks[0]?.bars[1]?.voices[0];
          if (!voice) throw new Error('no voice');
          return insertBeat({ voiceId: voice.id, index: 0, id: beatId });
        },
        setNote({ beatId }, { string: 2, fret: 3 }),
      ]),
    );
    expect(after.masterBars).toHaveLength(5);
    expect(beatOf(after, 0, 1, 0)).toMatchObject({ id: beatId, rest: false });
  });

  it('keeps patches and touched bars proportional to the steps on a long score', () => {
    const score = largeScore(8, 300);
    const id = newId();
    const command = chain('Edit bars', [
      removeBar({ masterBarId: masterBarId(score, 20) }),
      removeBar({ masterBarId: masterBarId(score, 5) }),
      insertBar({ index: 100, id }),
      insertBar({ index: 200 }),
    ]);
    const history = createHistory();
    const { score: after, change } = history.apply(score, command);
    expect(after.masterBars).toHaveLength(300);
    expect(change.patches.length).toBeLessThan(100);
    expect(change.inverse.length).toBeLessThan(100);
    expect(change.touchedBars.length).toBeLessThan(10);
    expect(validateScore(after)).toEqual([]);
    expect(history.undo()?.score).toEqual(score);
    expect(history.redo()?.score).toEqual(after);
  });

  it('refuses an empty chain', () => {
    expectRefusal(buildScore(), chain('Nothing', []), 'invalid-value');
  });

  it('undoes and redoes as one step with the chain name', () => {
    const score = buildScore();
    const id = newId();
    const history = createHistory();
    const applied = history.apply(
      score,
      chain('Add note', [
        insertBeat({ voiceId: voiceId(score, 2), index: 0, id }),
        setNote({ beatId: id }, { string: 3, fret: 4 }),
      ]),
    );
    expect(history.steps).toHaveLength(1);
    expect(history.undoLabel).toBe('Add note');
    expect(history.undo()?.score).toEqual(score);
    expect(history.canUndo).toBe(false);
    expect(history.redo()?.score).toEqual(applied.score);
    expect(history.canRedo).toBe(false);
  });

  it('reports the union of its steps change sets', () => {
    const score = buildScore();
    const single = (index: number): string[] =>
      applyCommand(score, removeBar({ masterBarId: masterBarId(score, index) })).change.touchedBars;
    const { change } = applyCommand(
      score,
      chain('Remove bars', [
        removeBar({ masterBarId: masterBarId(score, 2) }),
        removeBar({ masterBarId: masterBarId(score, 3) }),
      ]),
    );
    const union = new Set([...single(2), ...single(3)]);
    expect(new Set(change.touchedBars)).toEqual(union);
  });

  it('forwards the warnings of its steps', () => {
    const warning = { code: 'trill-dropped', noteId: newId(), message: 'x' } as const;
    const step: Command = {
      name: 'warns',
      run(_draft, warn) {
        warn(warning);
      },
    };
    expect(applyCommand(buildScore(), chain('Warn', [step])).warnings).toEqual([warning]);
  });

  it('nests: an inner chain is a step like any other', () => {
    const score = buildScore();
    const { score: after } = applyCommand(
      score,
      chain('Outer', [
        chain('Inner', [
          removeBar({ masterBarId: masterBarId(score, 3) }),
          removeBar({ masterBarId: masterBarId(score, 2) }),
        ]),
        removeBar({ masterBarId: masterBarId(score, 1) }),
      ]),
    );
    expect(after.masterBars.map((bar) => bar.id)).toEqual([masterBarId(score, 0)]);
  });
});

describe('setMasterBars', () => {
  it('validates once against the end state, so an order that fails bar by bar is accepted', () => {
    const score = buildScore();
    const first = masterBarId(score, 1);
    const second = masterBarId(score, 2);
    const edits = [
      { masterBarId: first, changes: { alternateEndings: [1] } },
      {
        masterBarId: second,
        changes: { alternateEndings: [2], repeat: { start: false, endCount: 2 } },
      },
    ];
    // The first volta has no repeat end of its own until the second bar is edited.
    expectRefusal(
      score,
      setMasterBar({ masterBarId: first }, { alternateEndings: [1] }),
      'invariant',
    );
    const history = createHistory();
    const { score: after } = history.apply(score, setMasterBars(edits));
    expect(after.masterBars[1]?.alternateEndings).toEqual([1]);
    expect(after.masterBars[2]?.repeat.endCount).toBe(2);
    expect(history.steps).toHaveLength(1);
    expect(history.undo()?.score).toEqual(score);
    expect(history.redo()?.score).toEqual(after);
  });

  it('refuses the whole edit when the end state is invalid', () => {
    const score = buildScore();
    expectRefusal(
      score,
      setMasterBars([
        { masterBarId: masterBarId(score, 0), changes: { tempo: { bpm: 90 } } },
        { masterBarId: masterBarId(score, 1), changes: { alternateEndings: [1] } },
      ]),
      'invariant',
    );
  });

  it('refuses a time signature that overfills a voice, and a bar named twice', () => {
    const score = buildScore();
    const id = masterBarId(score, 0);
    expectRefusal(
      score,
      setMasterBars([
        { masterBarId: id, changes: { timeSignature: { numerator: 2, denominator: 4 } } },
      ]),
      'voice-overfull',
    );
    expectRefusal(
      score,
      setMasterBars([
        { masterBarId: id, changes: { section: { name: 'a' } } },
        { masterBarId: id, changes: { section: { name: 'b' } } },
      ]),
      'invalid-value',
    );
  });

  it('refuses an empty list', () => {
    expectRefusal(buildScore(), setMasterBars([]), 'invalid-value');
  });

  it('composes inside a chain', () => {
    const score = buildScore();
    const { score: after } = applyCommand(
      score,
      chain('Range', [
        setMasterBars([{ masterBarId: masterBarId(score, 2), changes: { tempo: { bpm: 90 } } }]),
        removeBar({ masterBarId: masterBarId(score, 3) }),
      ]),
    );
    expect(after.masterBars[2]?.tempo?.bpm).toBe(90);
    expect(after.masterBars).toHaveLength(3);
  });
});
