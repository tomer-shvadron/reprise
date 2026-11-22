/**
 * The colours of an exported image: the light paper family from `index.css` (`--*-light`) as sRGB
 * hex, because a standalone SVG cannot use CSS variables or `oklch`. Export is always in print
 * colours, whatever the app's theme; `palette.test.ts` keeps these in step with the tokens.
 */
import type { ThemeRole } from '@reprise/layout';

export const PALETTE = {
  ink: '#15110d',
  muted: '#6e6862',
  accent: '#0069ca',
  /** The paper token, kept for tests; an export's white paper is pure white. */
  paper: '#fefcf7',
  white: '#ffffff',
  /** The mask's alpha channel: white shows, black cuts a hole. Not a theme colour. */
  maskHide: '#000000',
} as const;

/** The fill or stroke of a primitive's role: its `paper` role is a box that hides what is behind it. */
export function roleColour(role: ThemeRole): string {
  switch (role) {
    case 'ink':
      return PALETTE.ink;
    case 'muted':
      return PALETTE.muted;
    case 'accent':
      return PALETTE.accent;
    case 'paper':
      return PALETTE.white;
  }
}
