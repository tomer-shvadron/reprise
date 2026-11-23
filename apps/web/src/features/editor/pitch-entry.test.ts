import { describe, expect, it } from 'vitest';

import {
  chordPitch,
  clefOf,
  letterPitch,
  middleLine,
  pitchAtPosition,
  pitchName,
  stepPitch,
} from './pitch-entry';

const C = { fifths: 0, minor: false };
const G = { fifths: 1, minor: false };
const F = { fifths: -1, minor: false };
const D_MINOR = { fifths: -1, minor: true };

describe('letterPitch', () => {
  it('takes the alteration from the key signature', () => {
    expect(letterPitch('F', 66, G)).toBe(66);
    expect(letterPitch('F', 66, C)).toBe(65);
    expect(letterPitch('B', 70, F)).toBe(70);
    expect(letterPitch('B', 70, D_MINOR)).toBe(70);
    expect(letterPitch('E', 64, D_MINOR)).toBe(64);
  });

  it('takes the octave nearest the reference', () => {
    expect(letterPitch('C', 71, C)).toBe(72);
    expect(letterPitch('C', 60, C)).toBe(60);
    expect(letterPitch('G', 60, C)).toBe(55);
    expect(letterPitch('B', 74, C)).toBe(71);
  });

  it('goes up on a tritone', () => {
    // F4 to B4 is six semitones up, and B3 six down.
    expect(letterPitch('B', 65, C)).toBe(71);
    expect(letterPitch('F', 71, C)).toBe(77);
  });
});

describe('chordPitch', () => {
  it('is the nearest occurrence above the highest note', () => {
    expect(chordPitch('G', 76, C)).toBe(79);
    expect(chordPitch('C', 79, C)).toBe(84);
    expect(chordPitch('E', 76, C)).toBe(88);
    expect(chordPitch('F', 64, G)).toBe(66);
  });
});

describe('middleLine', () => {
  it('is B4 in treble and D3 in bass', () => {
    expect(middleLine('treble', 0)).toBe(71);
    expect(middleLine('bass', 0)).toBe(50);
  });

  it('follows the octave shift, written minus sounding', () => {
    expect(middleLine('treble', 1)).toBe(59);
    expect(middleLine('treble', -1)).toBe(83);
  });
});

describe('stepPitch', () => {
  it('moves a line or space in the key', () => {
    expect(stepPitch(71, C, -1)).toBe(72);
    expect(stepPitch(71, C, 1)).toBe(69);
    expect(stepPitch(65, G, -1)).toBe(67);
    expect(stepPitch(69, G, -1)).toBe(71);
    // F in G major is F sharp.
    expect(stepPitch(64, G, -1)).toBe(66);
  });

  it('takes the pitch of a note of the beat on that line, whatever its accidental', () => {
    const beat = [{ fret: 70, accidental: 'flat' as const }];
    expect(stepPitch(69, C, -1, beat)).toBe(70);
    expect(stepPitch(72, C, 1, beat)).toBe(70);
    // And back off it: from B flat the next line up is C.
    expect(stepPitch(70, C, -1, beat)).toBe(72);
  });

  it('stops at the ends of MIDI', () => {
    expect(stepPitch(127, C, -1)).toBeUndefined();
    expect(stepPitch(0, C, 1)).toBeUndefined();
  });
});

describe('pitchName', () => {
  it('writes the letter, its sign and the octave', () => {
    expect(pitchName(66, G)).toBe('F♯4');
    expect(pitchName(70, F)).toBe('B♭4');
    expect(pitchName(60, C)).toBe('C4');
    expect(pitchName(70, C, 'flat')).toBe('B♭4');
  });
});

describe('clefOf', () => {
  it('is the last clef change at or before the bar, else the track clef, else treble', () => {
    const bars = [{ clef: 'bass' as const }, {}, { clef: 'treble' as const }, {}] as never;
    expect(clefOf({ bars, display: { notation: 'standard', octaveShift: 0 } }, 1)).toBe('bass');
    expect(clefOf({ bars, display: { notation: 'standard', octaveShift: 0 } }, 3)).toBe('treble');
    expect(
      clefOf({ bars: [{}] as never, display: { notation: 'standard', octaveShift: 0 } }, 0),
    ).toBe('treble');
    expect(
      clefOf(
        { bars: [{}] as never, display: { notation: 'standard', clef: 'alto', octaveShift: 0 } },
        0,
      ),
    ).toBe('alto');
  });
});

describe('pitchAtPosition', () => {
  it('reads the staff from its bottom line, as staffPosition writes it', () => {
    expect(pitchAtPosition(0, 'treble', 0, C)).toBe(64);
    expect(pitchAtPosition(4, 'treble', 0, C)).toBe(71);
    expect(pitchAtPosition(-2, 'treble', 0, C)).toBe(60);
    expect(pitchAtPosition(0, 'bass', 0, C)).toBe(43);
  });

  it('takes the key and the written octave shift into account', () => {
    expect(pitchAtPosition(8, 'treble', 0, G)).toBe(78);
    // A guitar's sounding E2 is written where E3 is: the bottom line of treble reads E3 up an octave.
    expect(pitchAtPosition(0, 'treble', 1, C)).toBe(52);
  });
});
