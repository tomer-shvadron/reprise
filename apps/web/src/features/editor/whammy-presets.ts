import type { Whammy, WhammyKind } from '@reprise/model';

/** Quarter tones of the bar's travel (negative values dive). */
export const WHAMMY_AMOUNTS = { small: 2, medium: 4, large: 8 } as const;
export type WhammyAmount = keyof typeof WHAMMY_AMOUNTS;

export type WhammyShape = Extract<WhammyKind, 'dive' | 'dip' | 'releaseUp'>;

export const WHAMMY_SHAPES: readonly WhammyShape[] = ['dive', 'dip', 'releaseUp'];

/** The curve of a preset; `whammyKind` reads each back as its own kind after a gp export. */
export function whammyPreset(shape: WhammyShape, amount: WhammyAmount): Whammy {
  const v = WHAMMY_AMOUNTS[amount];
  const points = (list: readonly (readonly [number, number])[]) =>
    list.map(([position, value]) => ({ position, value }));
  switch (shape) {
    case 'dive':
      return {
        kind: 'dive',
        points: points([
          [0, 0],
          [45, -v],
          [60, -v],
        ]),
      };
    case 'dip':
      return {
        kind: 'dip',
        points: points([
          [0, 0],
          [30, -v],
          [60, 0],
        ]),
      };
    case 'releaseUp':
      return {
        kind: 'releaseUp',
        points: points([
          [0, -v],
          [60, 0],
        ]),
      };
  }
}

const AMOUNT_LABEL: Record<WhammyAmount, string> = {
  small: '½ step',
  medium: 'Whole step',
  large: '2 steps',
};
const SHAPE_LABEL: Record<WhammyShape, string> = {
  dive: 'dive',
  dip: 'dip',
  releaseUp: 'release up',
};

/** "Whole step dive", "2 steps release up": how a preset reads in a label. */
export function whammyPresetLabel(shape: WhammyShape, amount: WhammyAmount): string {
  return `${AMOUNT_LABEL[amount]} ${SHAPE_LABEL[shape]}`;
}
