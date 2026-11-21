import type { DurationSpec } from '@reprise/model/testing';

import { fromBars, fromMelody, type Expected, type Piece } from './corpus';

// Public-domain tunes (traditional or composed before 1900), keyed in by hand and abridged. Each
// carries the key a musician would give it, which is what the accuracy test expects.

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** `F#4/4`, `Bb3/8.`: a pitch and a duration; `-` and `+` are not used. */
function parse(text: string): (readonly [number, DurationSpec])[] {
  return text
    .trim()
    .split(/\s+/)
    .map((token) => {
      if (token.startsWith('R/')) return [-1, token.slice(2) as DurationSpec] as const;
      const match = /^([A-G])([#b]?)(\d)\/(\d+\.{0,2})$/.exec(token);
      if (!match) throw new Error(`bad note ${token}`);
      const [, letter = 'C', accidental = '', octave = '4', duration = '4'] = match;
      const pitch =
        12 * (Number(octave) + 1) +
        (NAMES[letter] ?? 0) +
        (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0);
      return [pitch, duration as DurationSpec] as const;
    });
}

const note = (name: string, octave: number): number => {
  const match = /^([A-G])([#b]?)$/.exec(name);
  const base =
    (NAMES[match?.[1] ?? 'C'] ?? 0) + (match?.[2] === '#' ? 1 : match?.[2] === 'b' ? -1 : 0);
  return 12 * (octave + 1) + base;
};

/** A chord as bass then upper notes, e.g. `chord('A2', 'E3', 'A3', 'C4', 'E4')`. */
const chord = (...names: string[]): number[] =>
  names.map((name) => {
    const match = /^([A-G][#b]?)(\d)$/.exec(name);
    return note(match?.[1] ?? 'C', Number(match?.[2]));
  });

export interface Tune {
  name: string;
  expected: Expected;
  /**
   * What the engine says today when it differs from `expected`, kept so a change shows up in the
   * test, and so the PR lists the miss. The rule was not tuned to make these pass.
   */
  known?: { tonic: number; quality: 'major' | 'minor' | 'none'; scale?: string; why: string };
  score: Piece['score'];
}

const E = NAMES.E ?? 0;

export const TUNES: Tune[] = [
  {
    // Beethoven, Ode to Joy.
    name: 'Ode to Joy (D major)',
    expected: { tonic: 2, quality: 'major' },
    score: fromMelody(
      parse(`
        F#4/4 F#4/4 G4/4 A4/4  A4/4 G4/4 F#4/4 E4/4  D4/4 D4/4 E4/4 F#4/4  F#4/4. E4/8 E4/2
        F#4/4 F#4/4 G4/4 A4/4  A4/4 G4/4 F#4/4 E4/4  D4/4 D4/4 E4/4 F#4/4  E4/4. D4/8 D4/2
        E4/4 E4/4 F#4/4 D4/4  E4/4 F#4/8 G4/8 F#4/4 D4/4  E4/4 F#4/8 G4/8 F#4/4 E4/4  D4/4 E4/4 A3/2
        F#4/4 F#4/4 G4/4 A4/4  A4/4 G4/4 F#4/4 E4/4  D4/4 D4/4 E4/4 F#4/4  E4/4. D4/8 D4/2
      `),
    ),
  },
  {
    // Amazing Grace, 3/4 with a pickup.
    name: 'Amazing Grace (G major)',
    expected: { tonic: 7, quality: 'major' },
    score: fromMelody(
      parse(`
        D4/4
        G4/2 B4/8 G4/8  B4/2 A4/4  G4/2 E4/4  D4/2 D4/4
        G4/2 B4/8 G4/8  B4/2 A4/4  D5/2.
        D5/2 B4/8 D5/8  B4/2 G4/4  D4/2 E4/8 D4/8  G4/2.
        G4/2 B4/8 G4/8  B4/2 A4/4  G4/2.
      `),
      { meter: [3, 4], pickup: 4 },
    ),
  },
  {
    name: 'Frere Jacques (F major)',
    expected: { tonic: 5, quality: 'major' },
    score: fromMelody(
      parse(`
        F4/4 G4/4 A4/4 F4/4  F4/4 G4/4 A4/4 F4/4  A4/4 Bb4/4 C5/2  A4/4 Bb4/4 C5/2
        C5/8 D5/8 C5/8 Bb4/8 A4/4 F4/4  C5/8 D5/8 C5/8 Bb4/8 A4/4 F4/4  F4/4 C4/4 F4/2  F4/4 C4/4 F4/2
      `),
    ),
  },
  {
    name: 'Twinkle, Twinkle (C major)',
    expected: { tonic: 0, quality: 'major' },
    score: fromMelody(
      parse(`
        C4/4 C4/4 G4/4 G4/4  A4/4 A4/4 G4/2  F4/4 F4/4 E4/4 E4/4  D4/4 D4/4 C4/2
        G4/4 G4/4 F4/4 F4/4  E4/4 E4/4 D4/2  G4/4 G4/4 F4/4 F4/4  E4/4 E4/4 D4/2
        C4/4 C4/4 G4/4 G4/4  A4/4 A4/4 G4/2  F4/4 F4/4 E4/4 E4/4  D4/4 D4/4 C4/2
      `),
    ),
  },
  {
    // Scarborough Fair, abridged. The C sharp is what makes it Dorian rather than natural minor.
    name: 'Scarborough Fair (E Dorian)',
    expected: { tonic: E, quality: 'minor', scale: 'dorian' },
    score: fromMelody(
      parse(`
        E4/4 B4/2 B4/4  F#4/2 G4/4  F#4/2 E4/4  E4/2.
        E5/2 D5/4  B4/2 A4/4  B4/2 C#5/4  D5/2.
        E5/2 E5/4  D5/2 B4/4  C#5/2 A4/4  B4/2.
        E4/4 B4/2  B4/2 F#4/4  G4/2 F#4/4  E4/2.
      `),
      { meter: [3, 4], pickup: 4 },
    ),
  },
  {
    // Drunken Sailor, the sea shanty's verse as sung: six As, then D F A; six Gs, then C E G; six
    // As, then B C D; then C A G E D D. The B natural is what makes it Dorian rather than natural
    // minor. A transcription of the contour, with the rhythm simplified.
    name: 'Drunken Sailor (D Dorian)',
    expected: { tonic: 2, quality: 'minor', scale: 'dorian' },
    known: {
      tonic: 2,
      quality: 'none',
      scale: 'suspendedPentatonic',
      why: 'the one F in the verse is under 2% of the weight, so the third is withheld; tonic right',
    },
    score: fromMelody(
      parse(`
        A4/8 A4/8 A4/8 A4/8 A4/8 A4/8 D5/8 F5/8  A5/2 R/2
        G4/8 G4/8 G4/8 G4/8 G4/8 G4/8 C5/8 E5/8  G5/2 R/2
        A4/8 A4/8 A4/8 A4/8 A4/8 A4/8 B4/8 C5/8  D5/2 R/2
        C5/4 A4/4 G4/4 E4/4  D4/2 D4/2
      `),
    ),
  },
  {
    // Greensleeves, in 3/4 and abridged.
    name: 'Greensleeves (A minor)',
    expected: { tonic: 9, quality: 'minor' },
    score: fromMelody(
      parse(`
        A4/4
        C5/2 D5/4  E5/4. F5/8 E5/4  D5/2 B4/4  G4/4. A4/8 B4/4  C5/2 A4/4  A4/4. G#4/8 A4/4  B4/2 G#4/4  E4/2
        A4/4  C5/2 D5/4  E5/4. F5/8 E5/4  D5/2 B4/4  G4/4. A4/8 B4/4  C5/4. B4/8 A4/4  G#4/4. F#4/8 G#4/4  A4/2.
      `),
      { meter: [3, 4], pickup: 4 },
    ),
  },
  {
    // House of the Rising Sun, the chords: Am C D F, Am C E E.
    name: 'House of the Rising Sun (A minor)',
    expected: { tonic: 9, quality: 'minor' },
    score: fromBars(
      [
        chord('A2', 'E3', 'A3', 'C4', 'E4'),
        chord('C3', 'G3', 'C4', 'E4', 'G4'),
        chord('D3', 'A3', 'D4', 'F#4'),
        chord('F2', 'C3', 'F3', 'A3', 'C4'),
        chord('A2', 'E3', 'A3', 'C4', 'E4'),
        chord('C3', 'G3', 'C4', 'E4', 'G4'),
        chord('E2', 'B2', 'E3', 'G#3', 'B3'),
        chord('E2', 'B2', 'E3', 'G#3', 'B3'),
      ].map((c) => ({ chord: c })),
    ),
  },
  {
    // Beethoven, Fur Elise, the opening.
    name: 'Fur Elise opening (A minor)',
    expected: { tonic: 9, quality: 'minor' },
    score: fromMelody(
      parse(`
        E5/16 D#5/16 E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 A4/8. C4/16 E4/16 A4/16 B4/8. E4/16 G#4/16 B4/16 C5/8.
        E4/16 E5/16 D#5/16 E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 A4/8. C4/16 E4/16 A4/16 B4/8. E4/16 C5/16 B4/16 A4/8.
        E5/16 D#5/16 E5/16 D#5/16 E5/16 B4/16 D5/16 C5/16 A4/8. C4/16 E4/16 A4/16 B4/8. E4/16 C5/16 B4/16 A4/8.
      `),
      {
        meter: [3, 8],
        // The left hand: A minor and E major arpeggios, which the right hand alone does not give.
        bass: parse(`
        R/8 R/8 R/8  R/8 R/8 R/8  A2/8 E3/8 A3/8  E2/8 E3/8 G#3/8  A2/8 E3/8 A3/8  R/8 R/8 R/8
        A2/8 E3/8 A3/8  E2/8 E3/8 G#3/8  A2/8 E3/8 A3/8  A2/8 E3/8 A3/8  E2/8 E3/8 G#3/8  A2/8 E3/8 A3/8
        A2/4. A2/4.
      `),
      },
    ),
  },
  {
    // Petzold (attributed to Bach), Minuet in G.
    name: 'Minuet in G (G major)',
    expected: { tonic: 7, quality: 'major' },
    score: fromMelody(
      parse(`
        D5/4 G4/8 A4/8 B4/8 C5/8  D5/4 G4/4 G4/4  E5/4 C5/8 D5/8 E5/8 F#5/8  G5/4 G4/4 G4/4
        C5/4 D5/8 C5/8 B4/8 A4/8  B4/4 C5/8 B4/8 A4/8 G4/8  F#4/4 G4/8 A4/8 B4/8 G4/8  B4/2.
      `),
      { meter: [3, 4] },
    ),
  },
  {
    // Spanish Romance, the arpeggiated opening.
    name: 'Spanish Romance (E minor)',
    expected: { tonic: E, quality: 'minor' },
    score: fromMelody(
      parse(
        [
          ['E3 G3 B3 E4 B3 G3 E3 G3', 'E3 G3 B3 E4 B3 G3 E3 G3'],
          ['B2 D#3 F#3 B3 F#3 D#3 B2 D#3', 'E3 G3 B3 E4 B3 G3 E3 G3'],
          ['A2 C3 E3 A3 E3 C3 A2 C3', 'E3 G3 B3 E4 B3 G3 E3 G3'],
          ['B2 D#3 F#3 A3 F#3 D#3 B2 D#3', 'E3 G3 B3 E4 B3 G3 E3 G3'],
        ]
          .flat()
          .map((bar) =>
            bar
              .split(' ')
              .map((n) => `${n}/8`)
              .join(' '),
          )
          .join(' '),
      ),
    ),
  },
  {
    // A 12-bar blues in E: the form, played as dominant sevenths.
    name: '12-bar blues (E)',
    expected: { tonic: E, quality: 'major' },
    score: fromBars(
      [
        'E2 B2 E3 G#3 D4',
        'E2 B2 E3 G#3 D4',
        'E2 B2 E3 G#3 D4',
        'E2 B2 E3 G#3 D4',
        'A2 E3 A3 C#4 G4',
        'A2 E3 A3 C#4 G4',
        'E2 B2 E3 G#3 D4',
        'E2 B2 E3 G#3 D4',
        'B2 F#3 B3 D#4 A4',
        'A2 E3 A3 C#4 G4',
        'E2 B2 E3 G#3 D4',
        'B2 F#3 B3 D#4 A4',
      ].map((c) => ({ chord: chord(...c.split(' ')) })),
    ),
  },
];
