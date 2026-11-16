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
