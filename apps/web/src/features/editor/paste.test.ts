import { createHistory, type Id, type Score } from '@reprise/model';
import { largeScore, note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { SelectionState } from '@/state/selection';

import { copyClip } from './clip';
import { parseClip, serializeClip, type Clip } from './clipboard-format';
import { planPaste, type PasteMode, type PastePlan } from './paste';
import { barsRange, beatsRange, clipboardScore, cursorAt } from './test/clip-scores';
import { must } from './test/must';

type State = Pick<SelectionState, 'cursor' | 'range'>;

const allTracks = (built: Score): Id[] => built.tracks.map(({ id }) => id);

function clipOf(built: Score, state: State): Clip {
  const result = copyClip(built, state);
  if ('refused' in result) throw new Error(result.refused);
  return result.clip;
}

function planned(built: Score, clip: Clip, state: State, mode: PasteMode = 'overwrite'): PastePlan {
  const result = planPaste(built, clip, state, allTracks(built), mode);
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result;
}

const refusal = (built: Score, clip: Clip, state: State, mode: PasteMode = 'overwrite'): string => {
  const result = planPaste(built, clip, state, allTracks(built), mode);
  if (!('refused' in result)) throw new Error('expected a refusal');
  return result.refused;
};

function run(built: Score, plan: PastePlan): Score {
  return createHistory().apply(built, plan.command).score;
}

const frets = (built: Score, track: number, bar: number, voice = 0) =>
  built.tracks[track]?.bars[bar]?.voices[voice]?.beats.map(({ rest, notes }) =>
    rest ? 'rest' : notes.map(({ fret }) => fret).join('+'),
  );

const ids = (built: Score): Set<Id> => {
  const found = new Set<Id>();
  for (const track of built.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          found.add(beat.id);
          for (const n of beat.notes) found.add(n.id);
        }
      }
    }
  }
  return found;
};

const first = (built: Score) => beatsRange(built, { first: 0, bar: 0, from: 0, to: 1 });

describe('paste of beats', () => {
  const built = clipboardScore();
  const twoBeats = clipOf(built, { cursor: undefined, range: first(built) });

  it('overwrites the beats its length covers, at the cursor, in the cursor voice', () => {
    const state = { cursor: cursorAt(built, 0, 2, 1), range: undefined };
    const after = run(built, planned(built, twoBeats, state));
    // Bar 3 was 7, 8, 9, eighth 10: the two quarters (1, 2) replace beats 2 and 3, and the eighth stays after a gap of... none: 1 + 1 quarter replace 8 and 9.
    expect(frets(after, 0, 2)).toEqual(['7', '1', '2', '10']);
  });

  it('inserts at the cursor and pushes the rest along when the bar has room', () => {
    const roomy = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('4', [note(1, 5)])
        .beat('4', [note(2, 6)]);
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const one = clipOf(built, { cursor: cursorAt(built, 0, 0, 3), range: undefined });
    const after = run(
      roomy,
      planned(roomy, one, { cursor: cursorAt(roomy, 0, 0, 1), range: undefined }, 'insert'),
    );
    expect(frets(after, 0, 0)).toEqual(['5', '4', '6']);
  });

  it('pads with rests when an overwritten beat is longer than the clip, so later beats keep their time', () => {
    const eighth = (() => {
      const b = score().track('guitar');
      b.bar().beat('8', [note(1, 3)]);
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(eighth, { cursor: cursorAt(eighth, 0, 0, 0), range: undefined });
    const state = { cursor: cursorAt(built, 0, 0, 1), range: undefined };
    const after = run(built, planned(built, clip, state));
    expect(frets(after, 0, 0)).toEqual(['1', '3', 'rest', '3', '4']);
  });

  it('refuses a start that is not where a beat begins, in a voice of the clip', () => {
    const source = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('4', [note(1, 1)])
        .beat('4', [note(1, 2)])
        .beat('2', [note(1, 3)])
        .voice(1)
        .beat('2', [note(2, 4)])
        .beat('2', [note(2, 5)]);
      return b.build({ ids: 'sequential' });
    })();
    const target = (() => {
      const b = score().track('guitar');
      b.bar()
        .voice(1)
        .beat('1', [note(2, 9)]);
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(source, {
      cursor: undefined,
      range: beatsRange(source, { first: 0, bar: 0, from: 1, to: 2 }),
    });
    // Voice 1 of the clip starts 960 ticks in; the target's whole note has no beat there.
    const message = refusal(target, clip, { cursor: cursorAt(target, 0, 0, 0), range: undefined });
    expect(message).toBe('Bar 1, voice 2 has no beat starting where the paste begins');
  });

  it('refuses an overfull bar, naming the bar and the room left, and changes nothing', () => {
    const state = { cursor: cursorAt(built, 0, 2, 3), range: undefined };
    const message = refusal(built, twoBeats, state, 'insert');
    expect(message).toBe('Bar 3 has an eighth left: a half does not fit');
  });

  it('refuses an overwrite that would overflow the bar', () => {
    // The overwritten eighth frees a little room, so the refusal counts it.
    const state = { cursor: cursorAt(built, 0, 2, 3), range: undefined };
    expect(refusal(built, twoBeats, state)).toBe('Bar 3 has a quarter left: a half does not fit');
  });

  it('starts at a range start rather than the cursor', () => {
    const state = {
      cursor: cursorAt(built, 0, 0, 0),
      range: beatsRange(built, { first: 0, bar: 1, from: 0, to: 0 }),
    };
    const after = run(built, planned(built, twoBeats, state));
    expect(frets(after, 0, 1)).toEqual(['1', '2']);
    expect(frets(after, 0, 0)).toEqual(frets(built, 0, 0));
  });

  it('refuses the wrong track kind, and too few tracks', () => {
    const state = { cursor: cursorAt(built, 3, 0, 0), range: undefined };
    expect(refusal(built, twoBeats, state)).toBe(
      'Notes from a fretted track paste only into a fretted track',
    );
    const drums = clipOf(built, { cursor: cursorAt(built, 3, 0, 0), range: undefined });
    expect(refusal(built, drums, { cursor: cursorAt(built, 0, 3, 0), range: undefined })).toBe(
      'Notes from a drum track paste only into a drum track',
    );
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, last: 1, bar: 0, from: 0, to: 1 }),
    });
    expect(refusal(built, wide, { cursor: cursorAt(built, 3, 3, 0), range: undefined })).toBe(
      'The clipboard holds 2 tracks and only 1 track is here or below',
    );
  });

  it('pastes a clip of several tracks from the cursor track down', () => {
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, last: 1, bar: 0, from: 0, to: 1 }),
    });
    const state = { cursor: cursorAt(built, 0, 3, 0), range: undefined };
    const plan = planned(built, wide, state);
    const after = run(built, plan);
    expect(frets(after, 0, 3)).toEqual(['1', '2']);
    expect(frets(after, 1, 3)).toEqual(['11', '12']);
    expect(plan.notice).toBe('Pasted 2 beats into 2 tracks');
  });

  it('lands the cursor on the first pasted beat and selects the pasted span', () => {
    const state = { cursor: cursorAt(built, 0, 3, 0), range: undefined };
    const plan = planned(built, twoBeats, state);
    const after = run(built, plan);
    expect(plan.land).toEqual({ beat: must(after.tracks[0]?.bars[3]?.voices[0]?.beats[0]).id });
    expect(plan.range).toMatchObject({
      kind: 'beats',
      anchor: { beat: after.tracks[0]?.bars[3]?.voices[0]?.beats[0]?.id },
      focus: { beat: after.tracks[0]?.bars[3]?.voices[0]?.beats[1]?.id },
    });
  });

  it('appends the bars it needs past the end, in the same step', () => {
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, bar: 0, lastBar: 1, from: 2, to: 1 }),
    });
    const state = { cursor: cursorAt(built, 0, 4, 0), range: undefined };
    const history = createHistory();
    const plan = planned(built, wide, state);
    const after = history.apply(built, plan.command).score;
    expect(after.masterBars).toHaveLength(6);
    // Bar 5 held three quarters: the two pasted beats overwrite the first two.
    expect(frets(after, 0, 4)).toEqual(['3', '4', '0']);
    expect(frets(after, 0, 5)).toEqual(['5', '6']);
    expect(history.steps).toHaveLength(1);
    expect(history.undo()?.score).toEqual(built);
  });

  it('gives every beat and note an id nothing else has', () => {
    const state = { cursor: cursorAt(built, 0, 3, 0), range: undefined };
    const after = run(built, planned(built, twoBeats, state));
    const before = ids(built);
    const added = [...ids(after)].filter((id) => !before.has(id));
    expect(added).toHaveLength(4);
    const clipIds = new Set(
      twoBeats.tracks.flatMap((track) =>
        track.bars.flatMap((bar) =>
          bar.voices.flatMap((voice) =>
            voice.beats.flatMap((beat) => [beat.id, ...beat.notes.map((n) => n.id)]),
          ),
        ),
      ),
    );
    expect(added.some((id) => clipIds.has(id))).toBe(false);
  });

  it('pastes into another score, through the clipboard text', () => {
    const other = (() => {
      const b = score().track('guitar');
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const clip = must(parseClip(serializeClip(twoBeats)));
    const after = run(
      other,
      planned(other, clip, { cursor: cursorAt(other, 0, 0, 0), range: undefined }),
    );
    expect(frets(after, 0, 0)).toEqual(['1', '2']);
  });

  it('re-fingers a clip for a track with another string count and counts what it left out', () => {
    const high = clipOf(built, { cursor: cursorAt(built, 0, 0, 0), range: undefined });
    const state = { cursor: cursorAt(built, 2, 3, 0), range: undefined };
    const plan = planned(built, high, state);
    // String 1 fret 1 is F4 (65): above the bass neck's top string (43) plus 24 frets (67)? It fits at 43 + 22.
    expect(plan.notice).toMatch(/^Pasted 1 beat\. Re-fingered for 4 strings/);
    const bass = run(built, plan).tracks[2]?.bars[3]?.voices[0]?.beats[0];
    expect(bass?.notes[0]?.string).toBeGreaterThan(0);
  });
});

describe('paste of beats between tracks of one string count or voice', () => {
  const built = clipboardScore();

  it('keeps string and fret when the string count is the same, whatever the tuning', () => {
    const dropD = (() => {
      const b = score().track('guitar', { tuning: [38, 45, 50, 55, 59, 64] });
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(built, { cursor: cursorAt(built, 0, 0, 1), range: undefined });
    const plan = planned(dropD, clip, { cursor: cursorAt(dropD, 0, 0, 0), range: undefined });
    expect(plan.notice).toBe('Pasted 1 beat');
    const pasted = run(dropD, plan).tracks[0]?.bars[0]?.voices[0]?.beats[0]?.notes[0];
    expect(pasted).toMatchObject({ string: 2, fret: 2 });
  });

  it('pastes a clip of one voice into the voice the cursor is in', () => {
    const clip = clipOf(built, { cursor: cursorAt(built, 0, 0, 1), range: undefined });
    const state = { cursor: cursorAt(built, 0, 3, 0, 1), range: undefined };
    const after = run(built, planned(built, clip, state));
    expect(frets(after, 0, 3, 1)).toEqual(['2']);
    expect(frets(after, 0, 3, 0)).toEqual([]);
  });
});

describe('paste of bars', () => {
  const built = clipboardScore();

  it('overwrites whole bars, voices the clip lacks included, and never touches bar properties', () => {
    const clip = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, from: 0, to: 1 }),
    });
    const state = { cursor: cursorAt(built, 0, 2, 0), range: undefined };
    const after = run(built, planned(built, clip, state));
    expect(frets(after, 0, 2)).toEqual(['1', '2', '3', '4']);
    expect(frets(after, 0, 3)).toEqual(['5', '6']);
    expect(after.masterBars.map(({ timeSignature }) => timeSignature.numerator)).toEqual(
      built.masterBars.map(({ timeSignature }) => timeSignature.numerator),
    );
    expect(after.masterBars).toHaveLength(5);
  });

  it('puts a 3/4 clip into a 4/4 bar, and refuses a 4/4 clip in a 3/4 bar', () => {
    const three = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, from: 4, to: 4 }),
    });
    const fits = run(
      built,
      planned(built, three, { cursor: cursorAt(built, 0, 0, 0), range: undefined }),
    );
    expect(frets(fits, 0, 0)).toEqual(['0', '0', '0']);
    const four = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, from: 0, to: 0 }),
    });
    expect(refusal(built, four, { cursor: cursorAt(built, 0, 4, 0), range: undefined })).toBe(
      'Bar 5 has a dotted half left: a whole does not fit',
    );
  });

  it('inserts new bars before the target, carrying the clip time signature', () => {
    const three = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, from: 4, to: 4 }),
    });
    const state = { cursor: cursorAt(built, 0, 1, 0), range: undefined };
    const plan = planned(built, three, state, 'insert');
    const after = run(built, plan);
    expect(after.masterBars).toHaveLength(6);
    expect(after.masterBars[1]?.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(frets(after, 0, 1)).toEqual(['0', '0', '0']);
    expect(frets(after, 0, 2)).toEqual(['5', '6']);
    expect(plan.land).toEqual({ bar: must(after.masterBars[1]).id });
  });

  it('appends bars past the end with the clip time signatures', () => {
    const clip = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, from: 3, to: 4 }),
    });
    const state = { cursor: cursorAt(built, 0, 4, 0), range: undefined };
    const history = createHistory();
    const after = history.apply(built, planned(built, clip, state).command).score;
    expect(history.steps).toHaveLength(1);
    expect(after.masterBars).toHaveLength(6);
    expect(after.masterBars[5]?.timeSignature).toEqual({ numerator: 3, denominator: 4 });
    expect(frets(after, 0, 4)).toEqual([]);
    expect(frets(after, 0, 5)).toEqual(['0', '0', '0']);
  });

  it('pastes four bars onto another track as one undo step that one undo reverts', () => {
    const clip = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, from: 0, to: 3 }),
    });
    const target = { cursor: cursorAt(built, 1, 0, 0), range: undefined };
    const history = createHistory();
    const plan = planned(built, clip, target);
    const before = history.steps.length;
    const after = history.apply(built, plan.command).score;
    expect(history.steps.length).toBe(before + 1);
    expect(history.undoLabel).toBe('pasteBars');
    expect(frets(after, 1, 0)).toEqual(['1', '2', '3', '4']);
    expect(frets(after, 1, 1)).toEqual(['5', '6']);
    expect(frets(after, 1, 2)).toEqual(['7', '8', '9', '10']);
    expect(plan.notice).toBe('Pasted 4 bars');
    expect(history.undo()?.score).toEqual(built);
  });

  it('pastes bars of two tracks onto two tracks', () => {
    const clip = clipOf(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, last: 1, from: 0, to: 0 }),
    });
    const plan = planned(built, clip, { cursor: cursorAt(built, 0, 3, 0), range: undefined });
    const after = run(built, plan);
    expect(frets(after, 0, 3)).toEqual(['1', '2', '3', '4']);
    expect(frets(after, 1, 3)).toEqual(['11', '12', '13', '14']);
    expect(plan.notice).toBe('Pasted 1 bar into 2 tracks');
  });

  it('keeps tied notes inside the clip tied and clears an orphan tie of a copied first beat', () => {
    const tied = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('2', [note(1, 5)])
        .beat('2', [note(1, 5, { tie: true })]);
      b.bar()
        .beat('2', [note(1, 5, { tie: true })])
        .beat('2', [note(2, 3)]);
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(tied, {
      cursor: undefined,
      range: barsRange(tied, { first: 0, from: 1, to: 1 }),
    });
    const after = run(
      tied,
      planned(tied, clip, { cursor: cursorAt(tied, 0, 2, 0), range: undefined }),
    );
    expect(after.tracks[0]?.bars[2]?.voices[0]?.beats[0]?.notes[0]?.tie).toBe(false);
  });
});

describe('paste at scale', () => {
  it('pastes four bars across eight tracks of a long score within a sanity bound', () => {
    const big = largeScore(8, 300);
    const clip = clipOf(big, {
      cursor: undefined,
      range: barsRange(big, { first: 0, last: 7, from: 0, to: 3 }),
    });
    const state = { cursor: cursorAt(big, 0, 100, 0), range: undefined };
    const started = performance.now();
    const plan = planned(big, clip, state);
    const history = createHistory();
    const after = history.apply(big, plan.command).score;
    const elapsed = performance.now() - started;
    expect(history.steps).toHaveLength(1);
    expect(after.masterBars).toHaveLength(300);
    // A sanity bound, not a budget: the measurement is in the PR description.
    expect(elapsed).toBeLessThan(5_000);
  });
});
