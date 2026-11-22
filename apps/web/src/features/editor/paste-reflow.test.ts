import {
  barTicks,
  beatTicks,
  createHistory,
  validateScore,
  type Beat,
  type Id,
  type Score,
} from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { array, assert, boolean, constantFrom, integer, property, tuple } from 'fast-check';
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

  it('copies a vibrato and a palm mute to the continuation, and leaves a dead note out of it', () => {
    const { second } = pasteHalf(halfNote({ vibrato: 'wide', palmMute: true }));
    expect(second?.notes[0]).toMatchObject({ vibrato: 'wide', palmMute: true, dead: false });
    const dead = pasteHalf(halfNote({ dead: true }));
    expect(dead.first?.notes[0]?.dead).toBe(true);
    expect(dead.second?.rest).toBe(true);
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
    if (!parsed) return;
    // The same as a clip that has its lengths.
    const after = run(target, planned(target, parsed, at(target, 4)));
    expect(shape(beatsOf(after, 0))).toEqual(['1:4', '2:4', '3:4', '4:8', '9:8']);
    expect(shape(beatsOf(after, 1))).toEqual(['~9:4.']);
  });
});

/** A 4/4 bar of these whole-bar voices: `[voice, fret][]` one whole note each. */
function wholes(bars: [number, number][][]): Score {
  const b = score().track('guitar');
  for (const voices of bars) {
    b.bar();
    for (const [voice, fret] of voices) {
      b.voice(voice as 0 | 1).beat('1', [note(voice + 1, fret)]);
    }
  }
  return b.build({ ids: 'sequential' });
}

describe('paste re-flow, edge cases', () => {
  const wholeClip = (built: Score, lastBar: number) =>
    clipOf(built, {
      cursor: undefined,
      range: beatsRange(built, { first: 0, bar: 0, lastBar, from: 0, to: 0 }),
    });

  it('keeps the length of a pickup bar it was copied from', () => {
    const source = (() => {
      const b = score().track('guitar');
      b.bar()
        .anacrusis()
        .beat('4', [note(1, 21)]);
      b.bar()
        .beat('4', [note(1, 22)])
        .beat('4', [note(1, 23)]);
      return b.build({ ids: 'sequential' });
    })();
    const range = beatsRange(source, { first: 0, bar: 0, lastBar: 1, from: 0, to: 1 });
    const clip = clipOf(source, { cursor: undefined, range });
    expect(clip.tracks[0]?.bars[0]?.ticks).toBe(960);
    const target = late();
    const after = run(target, planned(target, clip, at(target, 0)));
    // The second bar follows the pickup's beat at once, with no gap of three quarters.
    expect(shape(beatsOf(after, 0))).toEqual(['21:4', '22:4', '23:4', '4:8', '5:8']);

    // A clip from an older build has no length, so the written bar stands in and a gap shows.
    const older: Clip = {
      ...clip,
      tracks: clip.tracks.map((track) => ({
        ...track,
        bars: track.bars.map((bar) => {
          const copy = { ...bar };
          delete copy.ticks;
          return copy;
        }),
      })),
    };
    const gapped = run(target, planned(target, older, at(target, 0)));
    expect(shape(beatsOf(gapped, 0))).toEqual(['21:4', 'r2.']);
    expect(shape(beatsOf(gapped, 1)).slice(0, 2)).toEqual(['22:4', '23:4']);
  });

  it('fills a target pickup bar to the full meter, as its written length says', () => {
    const target = (() => {
      const b = score().track('guitar');
      b.bar()
        .anacrusis()
        .beat('4', [note(1, 1)]);
      b.bar().beat('1', [note(1, 2)]);
      return b.build({ ids: 'sequential' });
    })();
    const source = late();
    const clip = clipOf(source, {
      cursor: undefined,
      range: beatsRange(source, { first: 0, bar: 0, from: 0, to: 1 }),
    });
    const after = run(target, planned(target, clip, at(target, 0)));
    expect(shape(beatsOf(after, 0))).toEqual(['1:4', '2:4']);
  });

  it('refuses a piece no note value can write, naming the bar', () => {
    const source = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('4t', [note(1, 1)])
        .beat('4', [note(1, 2)]);
      return b.build({ ids: 'sequential' });
    })();
    const target = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('2', [note(1, 9)])
        .beat('4t', [note(1, 8)])
        .beat('4t', [note(1, 8)])
        .beat('4t', [note(1, 8)]);
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(source, {
      cursor: undefined,
      range: beatsRange(source, { first: 0, bar: 0, from: 0, to: 1 }),
    });
    // The triplet eighth fills 2560 to 3200, so the quarter has 640 ticks left in the bar.
    expect(refusal(target, clip, at(target, 2))).toBe(
      'Bar 1: the barline would split a beat into lengths no note value can write',
    );
  });

  it('refuses the whole paste when only the second track cannot be laid out', () => {
    const two = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('4t', [note(1, 21)])
        .beat('4t', [note(1, 22)]);
      b.track('guitar');
      b.bar()
        .beat('4t', [note(1, 11)])
        .beat('4', [note(1, 12)]);
      return b.build({ ids: 'sequential' });
    })();
    const target = (() => {
      const b = score().track('guitar');
      b.bar()
        .beat('2', [note(1, 9)])
        .beat('4t', [note(1, 8)])
        .beat('4t', [note(1, 8)])
        .beat('4t', [note(1, 8)]);
      b.bar();
      b.track('guitar');
      b.bar()
        .beat('2', [note(1, 9)])
        .beat('4t', [note(1, 8)])
        .beat('4t', [note(1, 8)])
        .beat('4t', [note(1, 8)]);
      b.bar();
      return b.build({ ids: 'sequential' });
    })();
    const clip = clipOf(two, {
      cursor: undefined,
      range: beatsRange(two, { first: 0, last: 1, bar: 0, from: 0, to: 1 }),
    });
    // Track 1 alone fits at this tick; track 2's quarter would leave a piece nothing writes.
    expect(refusal(target, clip, at(target, 2))).toContain('no note value can write');
    const onlyFirst = { ...clip, tracks: clip.tracks.slice(0, 1) };
    expect(
      'refused' in planPaste(target, onlyFirst, at(target, 2), allTracks(target), 'overwrite'),
    ).toBe(false);
  });

  it('keeps voices aligned across a bar a voice sits out, and skips the rests in an unused voice', () => {
    const source = wholes([
      [
        [0, 21],
        [1, 11],
      ],
      [[0, 22]],
      [
        [0, 23],
        [1, 13],
      ],
    ]);
    const clip = wholeClip(source, 2);
    // Into a target whose voice 2 is empty: bar 2's voice 2 stays empty, with no rests written.
    const empty = wholes([[[0, 1]], [[0, 2]], [[0, 3]]]);
    const into = run(empty, planned(empty, clip, at(empty, 0)));
    expect(shape(beatsOf(into, 0, 1))).toEqual(['11:1']);
    expect(shape(beatsOf(into, 1, 1))).toEqual([]);
    expect(shape(beatsOf(into, 2, 1))).toEqual(['13:1']);
    expect(shape(beatsOf(into, 1, 0))).toEqual(['22:1']);
    // Into a target whose voice 2 holds notes in bar 2: they are overwritten with a rest.
    const busy = wholes([
      [[0, 1]],
      [
        [0, 2],
        [1, 8],
      ],
      [[0, 3]],
    ]);
    const over = run(busy, planned(busy, clip, at(busy, 0)));
    expect(shape(beatsOf(over, 1, 1))).toEqual(['r1']);
    expect(shape(beatsOf(over, 2, 1))).toEqual(['13:1']);
  });
});

describe('paste re-flow keeps the sound', () => {
  const lengths = array(constantFrom('8', '4', '4.', '2', '16', '8.', '2.'), {
    minLength: 1,
    maxLength: 4,
  });
  // Each entry is a note (true) or a rest (false).
  const sounds = array(boolean(), { minLength: 4, maxLength: 4 });
  const meters = constantFrom([2, 4], [3, 4], [4, 4], [5, 8], [6, 8], [7, 8]);

  /** The eighths each meter holds. */
  const eighths = ([numerator, denominator]: readonly [number, number]) =>
    numerator * (denominator === 8 ? 1 : 2);

  it('keeps every pasted onset and length, never refuses, stays valid and is one undo step', () => {
    assert(
      property(
        lengths,
        sounds,
        array(tuple(meters, integer({ min: 1, max: 14 })), { minLength: 1, maxLength: 2 }),
        integer({ min: 0, max: 13 }),
        (clipLengths, clipSounds, bars, pick) => {
          const source = (() => {
            const b = score().track('guitar');
            const bar = b.bar();
            for (const [i, length] of clipLengths.entries()) {
              if (clipSounds[i]) bar.beat(length, [note(1, 20 + i)]);
              else bar.rest(length);
            }
            return b.build({ ids: 'sequential', validate: false });
          })();
          const target = (() => {
            const b = score().track('guitar');
            for (const [meter, wanted] of bars) {
              const [numerator, denominator] = meter;
              const bar = b.bar().timeSignature(numerator, denominator === 8 ? 8 : 4);
              for (let i = 0; i < Math.min(wanted, eighths(meter)); i++)
                bar.beat('8', [note(2, 1)]);
            }
            return b.build({ ids: 'sequential' });
          })();
          const stops = beatsOf(target, 0).length;
          const stop = pick % stops;
          const clip = clipOf(source, {
            cursor: undefined,
            range: beatsRange(source, { first: 0, bar: 0, from: 0, to: clipLengths.length - 1 }),
          });
          // Plain and dotted values pasted at a beat start in overwrite mode always fit.
          const plan = planned(target, clip, at(target, stop));
          const history = createHistory();
          const after = history.apply(target, plan.command).score;
          expect(history.steps).toHaveLength(1);
          expect(validateScore(after)).toEqual(validateScore(target));

          const starts: number[] = [];
          let origin = 0;
          for (const masterBar of after.masterBars) {
            starts.push(origin);
            origin += barTicks(masterBar);
          }
          const anchor = (starts[0] ?? 0) + stop * 480;
          // Merge each tie chain into one onset and length.
          const merged: [number, number][] = [];
          let restTicks = 0;
          for (const index of after.masterBars.keys()) {
            let at = starts[index] ?? 0;
            for (const beat of beatsOf(after, index)) {
              const [first] = beat.notes;
              const length = beatTicks(beat);
              if (beat.rest && at >= anchor) restTicks += length;
              if (first && first.fret >= 20) {
                if (first.tie)
                  merged[merged.length - 1] = [
                    merged.at(-1)?.[0] ?? 0,
                    (merged.at(-1)?.[1] ?? 0) + length,
                  ];
                else merged.push([at, length]);
              }
              at += length;
            }
          }
          const expected: [number, number][] = [];
          let running = anchor;
          let clipRests = 0;
          for (const beat of beatsOf(source, 0)) {
            const length = beatTicks(beat);
            if (beat.rest) clipRests += length;
            else expected.push([running, length]);
            running += length;
          }
          expect(merged).toEqual(expected);
          // The clip's rests are all there; the target's own rests only add to them.
          expect(restTicks).toBeGreaterThanOrEqual(clipRests);
          expect(history.undo()?.score).toEqual(target);
        },
      ),
      { numRuns: 120 },
    );
  });
});
