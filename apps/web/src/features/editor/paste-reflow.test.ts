import {
  beatTicks,
  createHistory,
  validateScore,
  type Beat,
  type Id,
  type Score,
} from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { array, assert, constantFrom, integer, property } from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { SelectionState } from '@/state/selection';

import { copyClip } from './clip';
import { parseClip, serializeClip, type Clip } from './clipboard-format';
import { planPaste, type PasteMode, type PastePlan } from './paste';
import { beatsRange, cursorAt } from './test/clip-scores';

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

const run = (built: Score, plan: PastePlan): Score =>
  createHistory().apply(built, plan.command).score;

const beatsOf = (built: Score, bar: number, voice = 0, track = 0): Beat[] =>
  built.tracks[track]?.bars[bar]?.voices[voice]?.beats ?? [];

const shape = (beats: readonly Beat[]) =>
  beats.map((beat) =>
    beat.rest
      ? `r${String(beat.duration)}${'.'.repeat(beat.dots)}`
      : `${beat.notes.map(({ fret, tie }) => `${tie ? '~' : ''}${String(fret)}`).join('+')}:${String(beat.duration)}${'.'.repeat(beat.dots)}`,
  );

/** A half note (fret 9, with these effects) on beat 3 of a 4/4 bar, then a quarter (fret 7) in the next. */
function halfNote(
  spec: Parameters<typeof note>[2] = {},
  beat: Parameters<ReturnType<typeof score>['beat']>[2] = {},
): Score {
  const b = score().track('guitar');
  b.bar().beat('2', [note(1, 9, spec)], beat);
  b.bar().beat('4', [note(1, 7)]);
  return b.build({ ids: 'sequential' });
}

/** Bar 1: three quarters then two eighths; bar 2 is empty. Stop 4 starts 3360 ticks in. */
function late(): Score {
  const b = score().track('guitar');
  b.bar()
    .beat('4', [note(2, 1)])
    .beat('4', [note(2, 2)])
    .beat('4', [note(2, 3)])
    .beat('8', [note(2, 4)])
    .beat('8', [note(2, 5)]);
  b.bar();
  return b.build({ ids: 'sequential' });
}

const halfClip = (built: Score) =>
  clipOf(built, {
    cursor: undefined,
    range: beatsRange(built, { first: 0, bar: 0, from: 0, to: 0 }),
  });

const at = (target: Score, stop: number, bar = 0, track = 0) => ({
  cursor: cursorAt(target, track, bar, stop),
  range: undefined,
});

function pasteHalf(built: Score, target = late(), stop = 4) {
  const after = run(target, planned(target, halfClip(built), at(target, stop)));
  return { after, first: beatsOf(after, 0).at(-1), second: beatsOf(after, 1)[0] };
}

describe('paste that re-flows across a barline', () => {
  it('cuts a half note an eighth before the barline into an eighth tied to a dotted quarter', () => {
    const { after } = pasteHalf(halfNote());
    expect(shape(beatsOf(after, 0))).toEqual(['1:4', '2:4', '3:4', '4:8', '9:8']);
    expect(shape(beatsOf(after, 1))).toEqual(['~9:4.']);
  });

  it('keeps a bend and a lyric on the first piece, and moves a legato slide to the last', () => {
    const { first, second } = pasteHalf(
      halfNote(
        {
          bend: {
            kind: 'bend',
            points: [
              { position: 0, value: 0 },
              { position: 60, value: 4 },
            ],
          },
          slide: ['legato', 'intoFromBelow'],
          staccato: true,
          vibrato: 'slight',
        },
        { text: 'hi', lyrics: ['la'] },
      ),
    );
    expect(first?.notes[0]?.bend).toBeDefined();
    expect(first?.notes[0]?.slide).toEqual(['intoFromBelow']);
    expect(first?.notes[0]?.staccato).toBe(false);
    expect(first?.text).toBe('hi');
    expect(first?.lyrics).toEqual(['la']);
    expect(second?.notes[0]?.bend).toBeUndefined();
    expect(second?.notes[0]?.slide).toEqual(['legato']);
    expect(second?.notes[0]?.staccato).toBe(true);
    // A bend spans its links: a vibrato on a link would stop it.
    expect(second?.notes[0]?.vibrato).toBe('none');
    expect(second?.text).toBeUndefined();
    expect(second?.lyrics).toBeUndefined();
    expect(second?.notes[0]?.tie).toBe(true);
  });

  it('copies a vibrato and a palm mute to the continuation, and never a dead note', () => {
    const { second } = pasteHalf(halfNote({ vibrato: 'wide', palmMute: true, dead: true }));
    expect(second?.notes[0]).toMatchObject({ vibrato: 'wide', palmMute: true, dead: false });
  });

  it('slices a whammy curve at the barline', () => {
    const { first, second } = pasteHalf(
      halfNote(
        {},
        {
          effects: {
            whammy: {
              kind: 'dive',
              points: [
                { position: 0, value: 0 },
                { position: 60, value: 8 },
              ],
            },
          },
        },
      ),
    );
    // 480 of 1920 ticks is a quarter of the curve: 0 to 2, then 2 to 8.
    expect(first?.effects.whammy?.points.map(({ value }) => value)).toEqual([0, 2]);
    expect(second?.effects.whammy?.points.map(({ value }) => value)).toEqual([2, 8]);
  });

  it('leaves a rest in place of a drum hit that a barline cuts', () => {
    const drums = (() => {
      const b = score().track('drums');
      b.bar().beat('2', [note(0, 38)]);
      return b.build({ ids: 'sequential' });
    })();
    const target = (() => {
      const b = score().track('drums');
      b.bar()
        .beat('4', [note(0, 36)])
        .beat('4', [note(0, 36)])
        .beat('4', [note(0, 36)])
        .beat('8', [note(0, 36)])
        .beat('8', [note(0, 36)]);
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const after = run(target, planned(target, halfClip(drums), at(target, 4)));
    expect(shape(beatsOf(after, 0)).at(-1)).toBe('38:8');
    expect(shape(beatsOf(after, 1))).toEqual(['r4.']);
  });

  it('refuses a barline inside a triplet and names it', () => {
    const triplets = (() => {
      const b = score().track('guitar');
      b.bar().beat('4t', [note(1, 1)]);
      return b.build({ ids: 'sequential' });
    })();
    const target = late();
    const message = refusal(target, halfClip(triplets), at(target, 4));
    expect(message).toBe(
      'Bar 2 would cut a triplet at the barline: paste where the tuplet fits, or copy whole bars',
    );
  });

  it('lays a 4/4 clip over 3/4 bars', () => {
    const wholeBar = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('4', [note(1, 21)])
        .beat('4', [note(1, 22)])
        .beat('4', [note(1, 23)])
        .beat('4', [note(1, 24)]);
      return b.build({ ids: 'sequential' });
    })();
    const target = (() => {
      const b = score().track('guitar');
      for (let i = 0; i < 2; i++) {
        b.bar()
          .timeSignature(3, 4)
          .beat('4', [note(2, 1)])
          .beat('4', [note(2, 2)])
          .beat('4', [note(2, 3)]);
      }
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(wholeBar, {
      cursor: undefined,
      range: beatsRange(wholeBar, { first: 0, bar: 0, from: 0, to: 3 }),
    });
    const after = run(target, planned(target, clip, at(target, 0)));
    expect(shape(beatsOf(after, 0))).toEqual(['21:4', '22:4', '23:4']);
    expect(shape(beatsOf(after, 1))).toEqual(['24:4', '2:4', '3:4']);
  });

  it('refuses an insert that would push a bar past its barline', () => {
    const target = late();
    const message = refusal(target, halfClip(halfNote()), at(target, 4), 'insert');
    // The bar is full, so the first piece (an eighth) already has no room.
    expect(message).toBe('Bar 1 is full: an eighth does not fit');
  });

  it('pastes in one undo step', () => {
    const target = late();
    const history = createHistory();
    const plan = planned(target, halfClip(halfNote()), at(target, 4));
    history.apply(target, plan.command);
    expect(history.steps).toHaveLength(1);
    expect(history.undo()?.score).toEqual(target);
    expect(plan.notice).toBe('Pasted 1 beat; 1 note tied over a barline');
  });

  it("appends bars in the last bar's meter", () => {
    const target = (() => {
      const b = score().track('guitar');
      b.bar().timeSignature(3, 4);
      b.bar()
        .timeSignature(3, 4)
        .beat('4', [note(1, 1)])
        .beat('4', [note(1, 2)])
        .beat('8', [note(1, 3)])
        .beat('8', [note(1, 4)]);
      return b.build({ ids: 'sequential' });
    })();
    const after = run(target, planned(target, halfClip(halfNote()), at(target, 3, 1)));
    expect(after.masterBars).toHaveLength(3);
    expect(after.masterBars[2]?.timeSignature).toEqual({ numerator: 3, denominator: 4 });
  });

  it('keeps two tracks aligned', () => {
    const two = (() => {
      const b = score().track('guitar');
      b.bar().beat('2', [note(1, 9)]);
      b.track('guitar');
      b.bar().beat('2', [note(1, 8)]);
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(two, {
      cursor: undefined,
      range: beatsRange(two, { first: 0, last: 1, bar: 0, from: 0, to: 0 }),
    });
    const target = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('4', [note(2, 1)])
        .beat('4', [note(2, 2)])
        .beat('4', [note(2, 3)])
        .beat('8', [note(2, 4)])
        .beat('8', [note(2, 5)]);
      b.bar();
      b.track('guitar');
      b.bar()
        .beat('4', [note(2, 1)])
        .beat('4', [note(2, 2)])
        .beat('4', [note(2, 3)])
        .beat('8', [note(2, 4)])
        .beat('8', [note(2, 5)]);
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const after = run(target, planned(target, clip, at(target, 4)));
    for (const track of [0, 1]) {
      expect(shape(beatsOf(after, 1, 0, track))).toEqual([
        '~' + String(track === 0 ? 9 : 8) + ':4.',
      ]);
    }
  });

  it('still pastes a clip from an older build, which has no bar lengths', () => {
    const target = late();
    const clip = clipOf(halfNote(), {
      cursor: undefined,
      range: beatsRange(halfNote(), { first: 0, bar: 0, from: 0, to: 0 }),
    });
    const text = serializeClip({
      ...clip,
      tracks: clip.tracks.map((track) => ({
        ...track,
        bars: track.bars.map((bar) => {
          const older = { ...bar };
          delete older.ticks;
          return older;
        }),
      })),
    });
    const parsed = parseClip(text);
    expect(parsed).toBeDefined();
    if (parsed)
      expect(
        'refused' in planPaste(target, parsed, at(target, 4), allTracks(target), 'overwrite'),
      ).toBe(false);
  });
});

describe('paste re-flow keeps the sound', () => {
  const lengths = array(constantFrom('8', '4', '4.', '2', '16', '8.', '2.'), {
    minLength: 1,
    maxLength: 4,
  });

  it('merges back into the clip, stays valid, and is one undo step', () => {
    assert(
      property(lengths, integer({ min: 0, max: 4 }), (clipLengths, stop) => {
        const source = (() => {
          const b = score().track('guitar');
          const bar = b.bar();
          for (const [i, length] of clipLengths.entries()) {
            bar.beat(length, [note(1, 20 + i)]);
          }
          return b.build({ ids: 'sequential', validate: false });
        })();
        const clip = clipOf(source, {
          cursor: undefined,
          range: beatsRange(source, { first: 0, bar: 0, from: 0, to: clipLengths.length - 1 }),
        });
        const target = late();
        const result = planPaste(target, clip, at(target, stop), allTracks(target), 'overwrite');
        if ('refused' in result) return;
        const history = createHistory();
        const after = history.apply(target, result.command).score;
        expect(history.steps).toHaveLength(1);
        expect(validateScore(after)).toEqual(validateScore(target));
        const merged: number[] = [];
        for (const beat of after.masterBars.flatMap((_, bar) => beatsOf(after, bar))) {
          const [first] = beat.notes;
          if (!first || first.fret < 20) continue;
          const length = beatTicks(beat);
          if (first.tie) merged[merged.length - 1] = (merged.at(-1) ?? 0) + length;
          else merged.push(length);
        }
        expect(merged).toEqual(beatsOf(source, 0).map((beat) => beatTicks(beat)));
        expect(history.undo()?.score).toEqual(target);
      }),
      { numRuns: 80 },
    );
  });
});
