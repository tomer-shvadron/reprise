import { describe, expect, it } from 'vitest';

import { hzFromMidi, isValidReference, midiFromHz, nearestNote, noteLabel } from './notes';

describe('notes', () => {
  it('maps hertz to MIDI against 440 and 432', () => {
    expect(midiFromHz(440)).toBeCloseTo(69, 10);
    expect(midiFromHz(432, 432)).toBeCloseTo(69, 10);
    expect(nearestNote(midiFromHz(440, 432)).cents).toBeCloseTo(31.77, 1);
    expect(hzFromMidi(57, 432)).toBeCloseTo(216, 6);
  });

  it('finds the nearest note and the signed cents', () => {
    expect(nearestNote(69.12).midi).toBe(69);
    expect(nearestNote(69.12).cents).toBeCloseTo(12, 6);
    expect(nearestNote(68.8)).toMatchObject({ midi: 69 });
    expect(nearestNote(68.8).cents).toBeCloseTo(-20, 6);
  });

  it('spells with sharps', () => {
    expect(noteLabel(45).text).toBe('A2');
    expect(noteLabel(46)).toMatchObject({ letter: 'A', accidental: '♯', octave: 2, text: 'A♯2' });
    expect(noteLabel(61).text).toBe('C♯4');
    expect(noteLabel(23).text).toBe('B0');
  });

  it('accepts whole references from 415 to 466 only', () => {
    expect(isValidReference(440)).toBe(true);
    expect(isValidReference(415)).toBe(true);
    expect(isValidReference(466)).toBe(true);
    expect(isValidReference(414)).toBe(false);
    expect(isValidReference(467)).toBe(false);
    expect(isValidReference(440.5)).toBe(false);
    expect(isValidReference(Number.NaN)).toBe(false);
  });
});
