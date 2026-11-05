import type { BendKind, BendPoint, Dynamics, Finger, WhammyKind } from '@reprise/model';

import { CorruptFile } from '../binary/binary-reader';
import type { Context } from './context';

/** GP3 to GP5 bend values are hundredths of a tone; the model counts quarter tones. */
const BEND_UNITS_PER_QUARTER_TONE = 25;
/** Point positions run 0 to 60 across the note in both GP and the model. */
const BEND_POSITION_MAX = 60;
const MAX_BEND_POINTS = 4 * BEND_POSITION_MAX;

export interface RawBend {
  type: number;
  points: BendPoint[];
  offset: number;
}

/**
 * The shared shape of note bends and the GP4+ tremolo bar: a type, a value the points make
 * redundant, then each point's position, value and a vibrato byte the model does not keep.
 */
export function readBendPoints(context: Context): RawBend {
  const { reader, log } = context;
  const offset = reader.offset;
  const type = reader.signedByte();
  reader.int();
  const count = reader.int();
  if (count < 0 || count > MAX_BEND_POINTS) {
    throw new CorruptFile(offset + 5, `${String(count)} bend points`);
  }
  const points: BendPoint[] = [];
  let vibrato = false;
  for (let i = 0; i < count; i++) {
    const position = reader.int();
    const value = reader.int();
    if (reader.bool()) vibrato = true;
    points.push({
      position: Math.min(BEND_POSITION_MAX, Math.max(0, position)),
      value: value / BEND_UNITS_PER_QUARTER_TONE,
    });
  }
  if (vibrato) log.info('bend-vibrato-dropped', 'vibrato on a bend point', { offset });
  return { type, points, offset };
}

const BEND_KINDS: Readonly<Record<number, BendKind>> = {
  1: 'bend',
  2: 'bendRelease',
  3: 'bendReleaseBend',
  4: 'prebend',
  5: 'prebendRelease',
};

export function bendKind(type: number): BendKind {
  return BEND_KINDS[type] ?? 'custom';
}

const WHAMMY_KINDS: Readonly<Record<number, WhammyKind>> = {
  6: 'dip',
  7: 'dive',
  8: 'releaseUp',
  9: 'invertedDip',
  10: 'return',
  11: 'releaseDown',
};

export function whammyKind(type: number): WhammyKind {
  return WHAMMY_KINDS[type] ?? 'custom';
}

const DYNAMICS: readonly Dynamics[] = ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff'];

/** GP numbers dynamics 1 (ppp) to 8 (fff); anything else is Guitar Pro's default, forte. */
export function dynamicsOf(value: number): Dynamics | undefined {
  return DYNAMICS[value - 1];
}

const FINGERS: readonly Finger[] = ['thumb', 'index', 'middle', 'ring', 'little'];

/** 0 to 4 are thumb (or p) to little finger (or c); negative values mean no finger. */
export function fingerOf(value: number): Finger | undefined {
  return FINGERS[value];
}

/**
 * The fret position a harmonic sounds at, for a node `delta` frets above the fretted note: the
 * nodes between the whole-number ones (the minor third at 3.2, the 2.4 above the open string)
 * are written where Guitar Pro draws them. Unlisted distances fall back to the octave.
 */
const HARMONIC_POSITIONS: Readonly<Record<number, number>> = {
  2: 2.4,
  3: 3.2,
  4: 4,
  5: 5,
  7: 7,
  8: 8.2,
  9: 9,
  10: 9.6,
  12: 12,
  14: 14.7,
  15: 14.7,
  16: 16,
  17: 17,
  19: 19,
  21: 21.7,
  22: 21.7,
  24: 24,
};

export function harmonicPosition(delta: number): number {
  return HARMONIC_POSITIONS[delta] ?? 12;
}
