import { createBeat, type Beat, type Note } from '@reprise/model';
import { note } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import type { Rhythm } from './rhythm';
import { splitBeat } from './split-beat';

const value = (duration: Rhythm['duration'], dots: Rhythm['dots'] = 0): Rhythm => ({
  duration,
  dots,
  tuplet: undefined,
});

/** A whole note cut into a quarter, a quarter and a half: a first, a middle and a last piece. */
const THREE = [value(4), value(4), value(2)];

const marked: Note = note(2, 7, {
  ghost: true,
  accent: 'heavy',
  hammerPull: true,
  pickScrape: 'down',
  leftHandFinger: 'index',
  rightHandFinger: 'middle',
  palmMute: true,
  letRing: true,
  harmonic: { kind: 'natural', value: 7 },
  trill: { fret: 9, speed: 16 },
  dynamics: 'ff',
  accidental: 'sharp',
  staccato: true,
  slide: ['shift', 'intoFromBelow', 'outUp'],
  vibrato: 'wide',
});

const effects = {
  tremoloPicking: 16,
  pickStroke: 'down',
  fadeIn: true,
  fadeOut: true,
  tapping: true,
  slapping: true,
  popping: true,
  wah: 'open',
  golpe: 'thumb',
  arpeggio: { direction: 'down' },
  brush: { direction: 'up' },
  vibrato: 'slight',
} as const;

const rich: Beat = createBeat({
  duration: 1,
  notes: [marked],
  effects,
  text: 'txt',
  chord: { name: 'Em' },
  lyrics: ['la'],
  grace: [{ duration: 16, before: true, notes: [note(2, 5)] }],
  mix: { volume: { value: 90 } },
});

const split = (beat: Beat, kind: 'fretted' | 'drums' | 'pitched' = 'fretted') =>
  splitBeat(beat, THREE, kind);

describe('splitBeat', () => {
  it('gives each piece the note value it was asked for', () => {
    expect(split(rich).map(({ duration, dots }) => [duration, dots])).toEqual([
      [4, 0],
      [4, 0],
      [2, 0],
    ]);
  });

  it('keeps the attack of the beat and its note on the first piece only', () => {
    const [first, middle, last] = split(rich);
    expect(first?.text).toBe('txt');
    expect(first?.chord).toEqual({ name: 'Em' });
    expect(first?.lyrics).toEqual(['la']);
    expect(first?.mix).toEqual({ volume: { value: 90 } });
    expect(first?.grace).toHaveLength(1);
    expect(first?.effects).toMatchObject({
      pickStroke: 'down',
      fadeIn: true,
      tapping: true,
      slapping: true,
      popping: true,
      wah: 'open',
      golpe: 'thumb',
      arpeggio: { direction: 'down' },
      brush: { direction: 'up' },
    });
    for (const later of [middle, last]) {
      expect(later?.text).toBeUndefined();
      expect(later?.chord).toBeUndefined();
      expect(later?.lyrics).toBeUndefined();
      expect(later?.mix).toBeUndefined();
      expect(later?.grace).toBeUndefined();
      expect(Object.keys(later?.effects ?? {}).sort()).not.toContain('pickStroke');
      expect(later?.effects.fadeIn).toBeUndefined();
      expect(later?.effects.tapping).toBeUndefined();
    }
    expect(first?.notes[0]).toMatchObject({
      ghost: true,
      accent: 'heavy',
      hammerPull: true,
      pickScrape: 'down',
      leftHandFinger: 'index',
      rightHandFinger: 'middle',
      tie: false,
    });
  });

  it('moves the end of the note to the last piece', () => {
    const [first, middle, last] = split(rich);
    expect(first?.notes[0]?.staccato).toBe(false);
    expect(first?.notes[0]?.slide).toEqual(['intoFromBelow']);
    expect(first?.effects.fadeOut).toBeUndefined();
    expect(middle?.notes[0]?.staccato).toBe(false);
    expect(middle?.notes[0]?.slide).toBeUndefined();
    expect(middle?.effects.fadeOut).toBeUndefined();
    expect(last?.notes[0]?.staccato).toBe(true);
    expect(last?.notes[0]?.slide).toEqual(['shift', 'outUp']);
    expect(last?.effects.fadeOut).toBe(true);
  });

  it('ties every later piece on and clears what only the attack carries', () => {
    const [, middle, last] = split(rich);
    for (const later of [middle, last]) {
      expect(later?.notes[0]).toMatchObject({
        string: 2,
        fret: 7,
        tie: true,
        ghost: false,
        accent: 'none',
        hammerPull: false,
        dead: false,
      });
      expect(later?.notes[0]?.pickScrape).toBeUndefined();
      expect(later?.notes[0]?.leftHandFinger).toBeUndefined();
      expect(later?.notes[0]?.rightHandFinger).toBeUndefined();
    }
  });

  it('copies the sustained marks to every later piece', () => {
    const [first, middle, last] = split(rich);
    for (const piece of [first, middle, last]) {
      expect(piece?.notes[0]).toMatchObject({
        palmMute: true,
        letRing: true,
        harmonic: { kind: 'natural', value: 7 },
        trill: { fret: 9, speed: 16 },
        dynamics: 'ff',
        accidental: 'sharp',
        vibrato: 'wide',
      });
      expect(piece?.effects.tremoloPicking).toBe(16);
      expect(piece?.effects.vibrato).toBe('slight');
    }
  });

  it('drops a vibrato that would stop a bend, on the note and on the beat', () => {
    const bent = createBeat({
      duration: 1,
      notes: [
        note(1, 5, {
          vibrato: 'wide',
          bend: {
            kind: 'bend',
            points: [
              { position: 0, value: 0 },
              { position: 60, value: 4 },
            ],
          },
        }),
      ],
      effects: { vibrato: 'wide' },
    });
    const [first, middle, last] = split(bent);
    expect(first?.notes[0]?.bend).toBeDefined();
    expect(first?.notes[0]?.vibrato).toBe('wide');
    expect(first?.effects.vibrato).toBe('wide');
    for (const later of [middle, last]) {
      expect(later?.notes[0]?.bend).toBeUndefined();
      expect(later?.notes[0]?.vibrato).toBe('none');
      expect(later?.effects.vibrato).toBeUndefined();
    }
  });

  it('leaves a volume swell off every piece, so no piece fades to silence', () => {
    const swelled = createBeat({
      duration: 1,
      notes: [note(1, 3)],
      effects: { volumeSwell: true },
    });
    for (const piece of split(swelled)) expect(piece.effects.volumeSwell).toBeUndefined();
  });

  it('leaves a dead note out of the later pieces, which become rests when it was alone', () => {
    const dead = createBeat({ duration: 1, notes: [note(1, 3, { dead: true })] });
    const [first, middle, last] = split(dead);
    expect(first?.notes[0]?.dead).toBe(true);
    for (const later of [middle, last]) {
      expect(later?.rest).toBe(true);
      expect(later?.notes).toEqual([]);
    }
    const chord = createBeat({
      duration: 1,
      notes: [note(1, 3, { dead: true }), note(2, 4)],
    });
    expect(split(chord)[1]?.notes.map(({ fret, tie }) => [fret, tie])).toEqual([[4, true]]);
  });

  it('slices a whammy at the cut and drops a flat slice that continues the last', () => {
    const whammy = createBeat({
      duration: 1,
      notes: [note(1, 3)],
      effects: {
        whammy: {
          kind: 'dive',
          points: [
            { position: 0, value: 0 },
            { position: 15, value: 6 },
            { position: 60, value: 6 },
          ],
        },
      },
    });
    const [first, middle, last] = split(whammy);
    // The first quarter is a quarter of the curve (positions 0 to 15): 0 up to 6. The rest holds 6.
    expect(first?.effects.whammy?.points.map(({ position, value }) => [position, value])).toEqual([
      [0, 0],
      [60, 6],
    ]);
    expect(first?.effects.whammy?.kind).toBe('custom');
    expect(middle?.effects.whammy).toBeUndefined();
    expect(last?.effects.whammy).toBeUndefined();
  });

  it('splits a rest into rests, and an empty beat into empty beats', () => {
    const rest = createBeat({ duration: 1, rest: true });
    expect(split(rest).map((piece) => [piece.rest, piece.notes.length])).toEqual([
      [true, 0],
      [true, 0],
      [true, 0],
    ]);
    const empty = createBeat({ duration: 1, rest: false });
    expect(split(empty).map((piece) => [piece.rest, piece.notes.length])).toEqual([
      [false, 0],
      [false, 0],
      [false, 0],
    ]);
  });

  it('turns every piece of a drum hit after the first into a rest', () => {
    const hit = createBeat({ duration: 1, notes: [note(0, 38, { accent: 'accent' })] });
    const [first, middle, last] = split(hit, 'drums');
    expect(first?.notes[0]).toMatchObject({ fret: 38, tie: false, accent: 'accent' });
    for (const later of [middle, last]) {
      expect(later?.rest).toBe(true);
      expect(later?.notes).toEqual([]);
    }
  });
});
