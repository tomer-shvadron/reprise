import type { Bend, BendKind } from '@reprise/model';

/** Quarter tones, as `BendPoint.value` counts them: the amounts scope-v1 offers. */
export const BEND_AMOUNTS = { quarter: 1, half: 2, full: 4 } as const;
export type BendAmount = keyof typeof BEND_AMOUNTS;

export type BendShape = Extract<BendKind, 'bend' | 'bendRelease' | 'prebend' | 'prebendRelease'>;

export const BEND_SHAPES: readonly BendShape[] = [
  'bend',
  'bendRelease',
  'prebend',
  'prebendRelease',
];

const AMOUNT_LABEL: Record<BendAmount, string> = { quarter: '¼', half: '½', full: 'Full' };
const SHAPE_LABEL: Record<BendShape, string> = {
  bend: 'bend',
  bendRelease: 'bend and release',
  prebend: 'prebend',
  prebendRelease: 'prebend and release',
};

/**
 * The curve of a preset, positions 0 to 60 across the note. Each is one gpif curve (an origin, at
 * most two middle points holding one value, a destination), so a gp export keeps it and reads
 * back the same kind. A prebend starts already raised, which a tied note cannot say: gpif reads
 * the curve of a tied note as a hold or release, so the editor refuses it there.
 */
export function bendPreset(shape: BendShape, amount: BendAmount): Bend {
  const v = BEND_AMOUNTS[amount];
  const points = (list: readonly (readonly [number, number])[]) =>
    list.map(([position, value]) => ({ position, value }));
  switch (shape) {
    case 'bend':
      return {
        kind: 'bend',
        points: points([
          [0, 0],
          [15, v],
          [60, v],
        ]),
      };
    case 'bendRelease':
      return {
        kind: 'bendRelease',
        points: points([
          [0, 0],
          [12, v],
          [36, v],
          [60, 0],
        ]),
      };
    case 'prebend':
      return {
        kind: 'prebend',
        points: points([
          [0, v],
          [60, v],
        ]),
      };
    case 'prebendRelease':
      return {
        kind: 'prebendRelease',
        points: points([
          [0, v],
          [30, v],
          [60, 0],
        ]),
      };
  }
}

/** "Full bend and release", "¼ prebend": how a preset reads in a label. */
export function bendPresetLabel(shape: BendShape, amount: BendAmount): string {
  return `${AMOUNT_LABEL[amount]} ${SHAPE_LABEL[shape]}`;
}

/** Whether a bend starts raised: its first point is above rest. */
export const startsRaised = (shape: BendShape): boolean =>
  shape === 'prebend' || shape === 'prebendRelease';
