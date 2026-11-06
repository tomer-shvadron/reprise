import type { Dynamics } from '@reprise/model';

import type { GlyphName } from '../metrics';

/** The precomposed Bravura glyph of each dynamic, the same on every staff. */
export const DYNAMICS_GLYPHS: Readonly<Record<Dynamics, GlyphName>> = {
  ppp: 'dynamicPPP',
  pp: 'dynamicPP',
  p: 'dynamicPiano',
  mp: 'dynamicMP',
  mf: 'dynamicMF',
  f: 'dynamicForte',
  ff: 'dynamicFF',
  fff: 'dynamicFFF',
};

/** Guitar Pro's default: a dynamic is only written where it changes from this. */
export const DEFAULT_DYNAMICS: Dynamics = 'f';
