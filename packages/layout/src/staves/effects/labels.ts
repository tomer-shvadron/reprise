import type { HarmonicKind, Note } from '@reprise/model';

const QUARTERS = ['', '¼', '½', '¾'] as const;

/** A bend or whammy amount in quarter tones as Guitar Pro writes it: `½`, `full`, `1½`, `-1`. */
export function bendLabel(value: number): string {
  const quarters = Math.round(Math.abs(value));
  if (quarters === 0) return '0';
  const sign = value < 0 ? '-' : '';
  if (quarters === 4) return `${sign}full`;
  const whole = Math.floor(quarters / 4);
  return `${sign}${whole > 0 ? String(whole) : ''}${QUARTERS[quarters % 4] ?? ''}`;
}

/** The lane label of a run of harmonics, by kind. */
export const HARMONIC_LABELS: Readonly<Record<HarmonicKind, string>> = {
  natural: 'N.H.',
  artificial: 'A.H.',
  tapped: 'T.H.',
  pinch: 'P.H.',
  semi: 'S.H.',
  feedback: 'Fdbk.',
};

/** A fret position with at most one decimal: `12`, `2.7`. */
export function fretNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** What a natural harmonic writes in place of its fret: the node, in angle brackets. */
export function naturalHarmonicText(note: Note): string | undefined {
  return note.harmonic?.kind === 'natural'
    ? `<${fretNumber(note.harmonic.value ?? note.fret)}>`
    : undefined;
}

/**
 * The small text after a fret number: a trill's other fret in parentheses, else an artificial
 * harmonic's sounding fret in angle brackets.
 */
export function suffixText(note: Note): string | undefined {
  if (note.trill) return `(${String(note.trill.fret)})`;
  const { harmonic } = note;
  if (!harmonic || harmonic.kind === 'natural') return undefined;
  return `<${fretNumber(note.fret + (harmonic.value ?? 12))}>`;
}
