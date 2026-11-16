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

/** One guitar track, one bar of eighths with these notes. */
function guitarWith(
  notes: ReturnType<typeof note>[][],
  track: { capo?: number } = {},
  spec: Parameters<ReturnType<typeof score>['beat']>[2] = {},
): Score {
  const b = score().track('guitar', track);
  const bar = b.bar();
  for (const chord of notes) bar.beat('8', chord, spec);
  return b.build({ ids: 'sequential' });
}

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
    // Bar 2's two quarters and bar 3's first two beats, from the start of a bar: 5 6 | 7 8.
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, bar: 1, lastBar: 2, from: 0, to: 1 }),
    });
    const state = { cursor: cursorAt(built, 0, 4, 0), range: undefined };
    const history = createHistory();
    const plan = planned(built, wide, state);
    const after = history.apply(built, plan.command).score;
    expect(after.masterBars).toHaveLength(6);
    // Bar 5 held three quarters: the two pasted beats overwrite the first two.
    expect(frets(after, 0, 4)).toEqual(['5', '6', '0']);
    expect(frets(after, 0, 5)).toEqual(['7', '8']);
    expect(history.steps).toHaveLength(1);
    expect(history.undo()?.score).toEqual(built);
  });

  it('keeps a clip over a barline contiguous: it pastes only at the position it was copied from', () => {
    // Beats 3 and 4 of bar 1 and beats 1 and 2 of bar 2: 3 4 | 5 6, started 1920 ticks into its bar.
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, bar: 0, lastBar: 1, from: 2, to: 1 }),
    });
    expect(refusal(built, wide, { cursor: cursorAt(built, 0, 4, 0), range: undefined })).toBe(
      'Paste this at the same beat position it was copied from, or copy whole bars',
    );
    // Beat 3 of bar 2 is where it came from: 5 6 [3 4 | 5 6 9 10].
    const after = run(
      built,
      planned(built, wide, { cursor: cursorAt(built, 0, 1, 2), range: undefined }),
    );
    expect(frets(after, 0, 1)).toEqual(['5', '6', '3', '4']);
    expect(frets(after, 0, 2)).toEqual(['5', '6', '9', '10']);
  });

  it('leaves a track with nothing in the span as it is, and pastes the rest', () => {
    // Bar 3 of the lead holds four beats; the rhythm track's bar 3 is empty.
    const span = {
      cursor: undefined,
      range: beatsRange(built, { first: 0, last: 1, bar: 2, from: 0, to: 3 }),
    };
    const clip = clipOf(built, span);
    expect(clip.tracks).toHaveLength(2);
    const plan = planned(built, clip, { cursor: cursorAt(built, 0, 3, 0), range: undefined });
    const after = run(built, plan);
    expect(frets(after, 0, 3)).toEqual(['7', '8', '9', '10']);
    expect(frets(after, 1, 3)).toEqual([]);
    expect(plan.range).toMatchObject({ kind: 'beats', anchor: { track: built.tracks[0]?.id } });
    // Every track empty is the only refusal, at copy.
    const nothing = copyClip(built, {
      cursor: undefined,
      range: barsRange(built, { first: 0, last: 1, from: 3, to: 3 }),
    });
    expect(nothing).toHaveProperty('refused');
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

  it('re-fingers by pitch with the exact result and the full notice', () => {
    const high = clipOf(built, { cursor: cursorAt(built, 0, 0, 0), range: undefined });
    const plan = planned(built, high, { cursor: cursorAt(built, 2, 3, 0), range: undefined });
    // String 1 fret 1 is F4 (65): on the bass, string 1 (43) fret 22.
    expect(plan.notice).toBe('Pasted 1 beat. Re-fingered for 4 strings');
    expect(run(built, plan).tracks[2]?.bars[3]?.voices[0]?.beats[0]?.notes[0]).toMatchObject({
      string: 1,
      fret: 22,
    });
  });

  it('leaves out a note the target cannot play and says how many, the beat becoming a rest', () => {
    const source = guitarWith([[note(1, 12)]]);
    const clip = clipOf(source, { cursor: cursorAt(source, 0, 0, 0), range: undefined });
    const plan = planned(built, clip, { cursor: cursorAt(built, 2, 3, 0), range: undefined });
    expect(plan.notice).toBe('Pasted 1 beat. Re-fingered for 4 strings; 1 note left out');
    expect(run(built, plan).tracks[2]?.bars[3]?.voices[0]?.beats[0]).toMatchObject({
      rest: true,
      notes: [],
    });
  });

  it('keeps the sounding pitch across capos, moves a trill, and says when one was dropped', () => {
    const capo = guitarWith([[note(4, 0, { trill: { fret: 2, speed: 16 } })]], { capo: 2 });
    const clip = clipOf(capo, { cursor: cursorAt(capo, 0, 0, 0), range: undefined });
    const plan = planned(built, clip, { cursor: cursorAt(built, 2, 3, 0), range: undefined });
    const pasted = run(built, plan).tracks[2]?.bars[3]?.voices[0]?.beats[0]?.notes[0];
    // D3 with the capo on 2 sounds E3 (52); the bass plays it on string 1, fret 9, the trill two frets up.
    expect(pasted).toMatchObject({ string: 1, fret: 9, trill: { fret: 11 } });
    const long = guitarWith([[note(3, 0, { trill: { fret: 14, speed: 16 } })]]);
    const dropped = planned(
      built,
      clipOf(long, { cursor: cursorAt(long, 0, 0, 0), range: undefined }),
      {
        cursor: cursorAt(built, 2, 3, 0),
        range: undefined,
      },
    );
    expect(dropped.notice).toBe('Pasted 1 beat. Re-fingered for 4 strings; 1 trill dropped');
  });

  it('names every neck it re-fingered', () => {
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, last: 1, bar: 0, from: 0, to: 0 }),
    });
    const seven = score().track('guitar', { tuning: [35, 40, 45, 50, 55, 59, 64] });
    seven.bar();
    seven.track('bass');
    seven.bar();
    const target = seven.build({ ids: 'sequential' });
    const plan = planned(target, wide, { cursor: cursorAt(target, 0, 0, 0), range: undefined });
    expect(plan.notice).toBe(
      'Pasted 1 beat into 2 tracks. Re-fingered for 7 strings and 4 strings; 1 note left out',
    );
  });

  it('skips a hidden track between the targets', () => {
    const wide = clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, last: 1, bar: 0, from: 0, to: 1 }),
    });
    const visible = [built.tracks[0], built.tracks[2], built.tracks[3]].flatMap((track) =>
      track ? [track.id] : [],
    );
    const result = planPaste(
      built,
      wide,
      { cursor: cursorAt(built, 0, 3, 0), range: undefined },
      visible,
      'overwrite',
    );
    if ('refused' in result) throw new Error(result.refused);
    const after = run(built, result);
    expect(frets(after, 0, 3)).toEqual(['1', '2']);
    expect(frets(after, 1, 3)).toEqual([]);
    // The second clip track went to the bass, the next visible one, and was re-fingered.
    expect(after.tracks[2]?.bars[3]?.voices[0]?.beats).toHaveLength(2);
  });

  it('pastes pitched notes into a pitched track only', () => {
    const keys = (() => {
      const b = score().track('piano');
      b.bar()
        .beat('4', [note(0, 60)])
        .beat('4', [note(0, 64)]);
      b.track('piano');
      b.bar();
      b.track('drums');
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(keys, { cursor: cursorAt(keys, 0, 0, 0), range: undefined });
    expect(refusal(keys, clip, { cursor: cursorAt(keys, 2, 0, 0), range: undefined })).toBe(
      'Notes from a pitched track paste only into a pitched track',
    );
    const after = run(
      keys,
      planned(keys, clip, { cursor: cursorAt(keys, 1, 0, 0), range: undefined }),
    );
    expect(after.tracks[1]?.bars[0]?.voices[0]?.beats[0]?.notes[0]).toMatchObject({
      string: 0,
      fret: 60,
    });
    expect(refusal(built, clip, { cursor: cursorAt(built, 0, 3, 0), range: undefined })).toBe(
      'Notes from a pitched track paste only into a pitched track',
    );
  });
});

describe('paste at the edges of tuplets and grace notes', () => {
  const triplets = (() => {
    const b = score().track('guitar');
    b.bar()
      .beat('8t', [note(1, 1)])
      .beat('8t', [note(1, 2)])
      .beat('8t', [note(1, 3)])
      .beat('4', [note(1, 4)])
      .beat('2', [note(1, 5)]);
    b.bar();
    return b.build({ ids: 'sequential' });
  })();

  it('copies part of a triplet group and pastes it as it is', () => {
    const clip = clipOf(triplets, {
      cursor: undefined,
      range: beatsRange(triplets, { first: 0, bar: 0, from: 1, to: 2 }),
    });
    const after = run(
      triplets,
      planned(triplets, clip, { cursor: cursorAt(triplets, 0, 1, 0), range: undefined }),
    );
    const beats = after.tracks[0]?.bars[1]?.voices[0]?.beats ?? [];
    expect(beats.map(({ tuplet }) => tuplet)).toEqual([
      { n: 3, of: 2 },
      { n: 3, of: 2 },
    ]);
  });

  it('refuses an overwrite that would split a triplet, saying so', () => {
    const eighth = (() => {
      const b = score().track('guitar');
      b.bar().beat('8', [note(1, 9)]);
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(eighth, { cursor: cursorAt(eighth, 0, 0, 0), range: undefined });
    expect(refusal(triplets, clip, { cursor: cursorAt(triplets, 0, 0, 0), range: undefined })).toBe(
      'Bar 1, voice 1 would split a tuplet or leave a gap no rest can fill',
    );
  });

  it('gives the grace notes of a pasted beat ids of their own', () => {
    const ornamented = guitarWith(
      [[note(2, 3)]],
      {},
      { grace: [{ duration: 16, before: true, notes: [note(2, 1)] }] },
    );
    const clip = clipOf(ornamented, { cursor: cursorAt(ornamented, 0, 0, 0), range: undefined });
    const target = clipboardScore();
    const after = run(
      target,
      planned(target, clip, { cursor: cursorAt(target, 0, 3, 0), range: undefined }),
    );
    const pasted = after.tracks[0]?.bars[3]?.voices[0]?.beats[0];
    const original = ornamented.tracks[0]?.bars[0]?.voices[0]?.beats[0];
    expect(pasted?.grace?.[0]?.notes[0]?.fret).toBe(1);
    expect(pasted?.grace?.[0]?.notes[0]?.id).not.toBe(original?.grace?.[0]?.notes[0]?.id);
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
