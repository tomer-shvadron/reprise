import { describe, expect, it } from 'vitest';

import { createNote, createTrack } from './factories';
import type { KeySignature } from './master-bar';
import type { Accidental } from './note';
import { LETTERS, keyAlter, respell, spell, spellNote, staffPosition } from './spelling';
import type { Letter, PitchedClef, Spelling } from './spelling';

const SIGN: Record<number, string> = { [-2]: 'bb', [-1]: 'b', 0: '', 1: '#', 2: '##' };

/** `C#` for a note the key spells, `C#!` when an accidental is printed against the key. */
function label(spelling: Spelling): string {
  return `${spelling.letter}${SIGN[spelling.alter] ?? '?'}${spelling.accidental ? '!' : ''}`;
}

const key = (fifths: number, minor = false): KeySignature => ({ fifths, minor });

describe('spell', () => {
  // Pitch classes C to B, one octave from middle C.
  const MAJOR: [string, number, string][] = [
    ['Cb', -7, 'C! Db D! Eb Fb F! Gb G! Ab A! Bb Cb'],
    ['Gb', -6, 'C! Db D! Eb E! F Gb G! Ab A! Bb Cb'],
    ['Db', -5, 'C Db D! Eb E! F Gb G! Ab A! Bb B!'],
    ['Ab', -4, 'C Db D! Eb E! F Gb! G Ab A! Bb B!'],
    ['Eb', -3, 'C Db! D Eb E! F Gb! G Ab A! Bb B!'],
    ['Bb', -2, 'C Db! D Eb E! F Gb! G Ab! A Bb B!'],
    ['F', -1, 'C Db! D Eb! E F Gb! G Ab! A Bb B!'],
    ['C', 0, 'C C#! D D#! E F F#! G G#! A A#! B'],
    ['G', 1, 'C C#! D D#! E F! F# G G#! A A#! B'],
    ['D', 2, 'C! C# D D#! E F! F# G G#! A A#! B'],
    ['A', 3, 'C! C# D D#! E F! F# G! G# A A#! B'],
    ['E', 4, 'C! C# D! D# E F! F# G! G# A A#! B'],
    ['B', 5, 'C! C# D! D# E F! F# G! G# A! A# B'],
    ['F#', 6, 'C! C# D! D# E! E# F# G! G# A! A# B'],
    ['C#', 7, 'B# C# D! D# E! E# F# G! G# A! A# B!'],
  ];
  const MINOR: [string, number, string][] = [
    ['Ab', -7, 'C! Db D! Eb Fb F! Gb G! Ab A! Bb Cb'],
    ['Eb', -6, 'C! Db D! Eb E! F Gb G! Ab A! Bb Cb'],
    ['Bb', -5, 'C Db D! Eb E! F Gb G! Ab A! Bb B!'],
    ['F', -4, 'C Db D! Eb E! F Gb! G Ab A! Bb B!'],
    ['C', -3, 'C Db! D Eb E! F Gb! G Ab A! Bb B!'],
    ['G', -2, 'C Db! D Eb E! F F#! G Ab! A Bb B!'],
    ['D', -1, 'C C#! D Eb! E F Gb! G Ab! A Bb B!'],
    ['A', 0, 'C C#! D D#! E F F#! G G#! A A#! B'],
    ['E', 1, 'C C#! D D#! E F! F# G G#! A A#! B'],
    ['B', 2, 'C! C# D D#! E F! F# G G#! A A#! B'],
    ['F#', 3, 'C! C# D D#! E E#! F# G! G# A A#! B'],
    ['C#', 4, 'B#! C# D! D# E F! F# G! G# A A#! B'],
    ['G#', 5, 'C! C# D! D# E E#! F# F##! G# A! A# B'],
    ['D#', 6, 'B#! C# C##! D# E! E# F# G! G# A! A# B'],
    ['A#', 7, 'B# C# D! D# E! E# F# F##! G# G##! A# B!'],
  ];

  it.each([
    ...MAJOR.map(([tonic, fifths, row]) => ({ name: `${tonic} major`, fifths, minor: false, row })),
    ...MINOR.map(([tonic, fifths, row]) => ({ name: `${tonic} minor`, fifths, minor: true, row })),
  ])('$name spells all twelve pitch classes', ({ fifths, minor, row }) => {
    const spelled = Array.from({ length: 12 }, (_, pitchClass) =>
      label(spell(60 + pitchClass, key(fifths, minor))),
    );
    expect(spelled.join(' ')).toBe(row);
  });

  it.each(Array.from({ length: 15 }, (_, index) => index - 7))(
    'in %i fifths every spelling sounds its pitch and only off-key notes print an accidental',
    (fifths) => {
      for (const minor of [false, true]) {
        for (let midi = 0; midi <= 127; midi++) {
          const spelling = spell(midi, key(fifths, minor));
          const natural = [0, 2, 4, 5, 7, 9, 11][LETTERS.indexOf(spelling.letter)];
          expect((spelling.octave + 1) * 12 + (natural ?? Number.NaN) + spelling.alter).toBe(midi);
          expect(spelling.accidental === undefined).toBe(
            spelling.alter === keyAlter(key(fifths), spelling.letter),
          );
        }
      }
    },
  );

  it.each<[string, number, number, string]>([
    ['A minor', 0, 66, 'F#!'],
    ['A minor', 0, 68, 'G#!'],
    ['D minor', -1, 71, 'B!'],
    ['C minor', -3, 69, 'A!'],
    ['G# minor', 5, 65, 'E#!'],
    ['D# minor', 6, 60, 'B#!'],
    ['A# minor', 7, 67, 'F##!'],
  ])('raises the sixth and seventh of %s: MIDI %i is %s', (_name, fifths, midi, expected) => {
    expect(label(spell(midi, key(fifths, true)))).toBe(expected);
  });

  it('takes the octave from the letter', () => {
    expect(spell(60, key(0))).toEqual({ letter: 'C', octave: 4, alter: 0 });
    expect(spell(60, key(7))).toEqual({ letter: 'B', octave: 3, alter: 1 });
    expect(spell(59, key(-7))).toEqual({ letter: 'C', octave: 4, alter: -1 });
    expect(spell(0, key(0))).toEqual({ letter: 'C', octave: -1, alter: 0 });
    expect(spell(127, key(0))).toEqual({ letter: 'G', octave: 9, alter: 0 });
  });

  it.each<[number, Accidental, KeySignature, string]>([
    [61, 'flat', key(0), 'Db!'],
    [61, 'sharp', key(-1), 'C#!'],
    [60, 'sharp', key(0), 'B#!'],
    [62, 'doubleSharp', key(0), 'C##!'],
    [62, 'doubleFlat', key(0), 'Ebb!'],
    [64, 'flat', key(0), 'Fb!'],
    [66, 'sharp', key(1), 'F#'],
    [65, 'natural', key(1), 'F!'],
  ])(
    'honours a stored accidental: MIDI %i as %s is %s',
    (midi, accidental, signature, expected) => {
      expect(label(spell(midi, signature, accidental))).toBe(expected);
    },
  );

  it('ignores a stored accidental that cannot spell the pitch', () => {
    expect(label(spell(61, key(0), 'natural'))).toBe('C#!');
    expect(label(spell(60, key(0), 'flat'))).toBe('C');
  });

  it('spells a note on its track', () => {
    const guitar = createTrack('fretted');
    expect(label(spellNote(guitar, createNote({ string: 2, fret: 2 }), key(-2)))).toBe('Db!');
    expect(
      label(spellNote(guitar, createNote({ string: 2, fret: 2, accidental: 'sharp' }), key(-2))),
    ).toBe('C#!');
  });
});

describe('keyAlter', () => {
  it('follows the order of sharps and flats', () => {
    const sharps: Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    expect(sharps.map((letter) => keyAlter(key(2), letter))).toEqual([1, 1, 0, 0, 0, 0, 0]);
    expect(sharps.map((letter) => keyAlter(key(-3), letter))).toEqual([0, 0, 0, 0, -1, -1, -1]);
  });
});

describe('respell', () => {
  const piano = createTrack('pitched');
  const C_MAJOR = key(0);

  function cycle(midi: number, signature: KeySignature, steps: number): string[] {
    let note = createNote({ string: 0, fret: midi });
    const seen: string[] = [];
    for (let step = 0; step < steps; step++) {
      note = respell(piano, note, signature);
      seen.push(label(spell(midi, signature, note.accidental)));
    }
    return seen;
  }

  it.each<[number, KeySignature, string[]]>([
    [61, C_MAJOR, ['Db!', 'C#!']],
    [60, C_MAJOR, ['B#!', 'C']],
    [64, C_MAJOR, ['Fb!', 'E']],
    [65, C_MAJOR, ['E#!', 'F']],
    [71, C_MAJOR, ['Cb!', 'B']],
    [62, C_MAJOR, ['Ebb!', 'C##!', 'D']],
    [70, key(-1), ['A#!', 'Bb']],
  ])('MIDI %i cycles through %j', (midi, signature, expected) => {
    expect(cycle(midi, signature, expected.length)).toEqual(expected);
  });

  it('stores the new spelling and clears it once back on the default', () => {
    const note = createNote({ string: 0, fret: 61 });
    const flipped = respell(piano, note, C_MAJOR);
    expect(flipped).toEqual({ ...note, accidental: 'flat' });
    expect(respell(piano, flipped, C_MAJOR)).toEqual(note);
  });

  it('respells fretted notes through the tuning', () => {
    const guitar = createTrack('fretted', { capo: 2 });
    expect(respell(guitar, createNote({ string: 1, fret: 2 }), C_MAJOR).accidental).toBe('flat');
  });

  it('leaves drum notes alone', () => {
    const note = createNote({ string: 0, fret: 38 });
    expect(respell(createTrack('drums'), note, C_MAJOR)).toBe(note);
  });
});

describe('staffPosition', () => {
  it.each<[PitchedClef, Letter, number, number]>([
    ['treble', 'E', 4, 0],
    ['treble', 'B', 4, 4],
    ['treble', 'F', 5, 8],
    ['treble', 'C', 4, -2],
    ['treble', 'A', 5, 10],
    ['bass', 'G', 2, 0],
    ['bass', 'D', 3, 4],
    ['bass', 'A', 3, 8],
    ['bass', 'C', 4, 10],
    ['bass', 'E', 2, -2],
    ['alto', 'F', 3, 0],
    ['alto', 'C', 4, 4],
    ['alto', 'G', 4, 8],
    ['tenor', 'D', 3, 0],
    ['tenor', 'C', 4, 6],
    ['tenor', 'E', 4, 8],
    ['tenor', 'B', 2, -2],
  ])('%s clef puts %s%i at %i', (clef, letter, octave, position) => {
    expect(staffPosition({ letter, octave }, clef)).toBe(position);
  });

  it('places spelled notes, with the letter deciding the line', () => {
    expect(staffPosition(spell(60, key(7)), 'treble')).toBe(-3);
    expect(staffPosition(spell(60, key(0)), 'treble')).toBe(-2);
    expect(staffPosition(spell(40, key(0)), 'treble')).toBe(-14);
  });

  it('writes a transposing staff the given octaves above sounding pitch', () => {
    const guitar = createTrack('fretted');
    expect(staffPosition(spell(40, key(0)), 'treble', guitar.display.octaveShift)).toBe(-7);
    expect(staffPosition({ letter: 'E', octave: 1 }, 'bass', 1)).toBe(-2);
    expect(staffPosition({ letter: 'C', octave: 4 }, 'treble', -1)).toBe(-9);
  });
});
