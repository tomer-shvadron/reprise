import { describe, expect, it } from 'vitest';

import { PERCUSSION_INSTRUMENTS, percussionInstrument } from './percussion';

const range = (from: number, to: number): number[] =>
  Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('percussionInstrument', () => {
  it.each(range(35, 81))('maps GM note %i', (midi) => {
    expect(percussionInstrument(midi)).toMatchObject({ midi });
  });

  it.each([...range(27, 34), ...range(82, 87)])('maps GM2 note %i', (midi) => {
    expect(percussionInstrument(midi)).toMatchObject({ midi });
  });

  it.each([
    [35, 'Acoustic Bass Drum', 0, 'normal'],
    [36, 'Bass Drum 1', 1, 'normal'],
    [38, 'Acoustic Snare', 5, 'normal'],
    [42, 'Closed Hi-Hat', 9, 'cross'],
    [44, 'Pedal Hi-Hat', -1, 'cross'],
    [46, 'Open Hi-Hat', 9, 'cross'],
    [49, 'Crash Cymbal 1', 10, 'cross'],
    [51, 'Ride Cymbal 1', 8, 'cross'],
    [53, 'Ride Bell', 8, 'diamond'],
    [55, 'Splash Cymbal', 11, 'cross'],
    [80, 'Mute Triangle', 11, 'cross'],
    [81, 'Open Triangle', 11, 'normal'],
  ])('%i is %s at %i with a %s head', (midi, name, staffPosition, noteHead) => {
    expect(percussionInstrument(midi)).toEqual({ midi, name, staffPosition, noteHead });
  });

  it('is undefined outside GM and GM2', () => {
    expect(percussionInstrument(26)).toBeUndefined();
    expect(percussionInstrument(88)).toBeUndefined();
    expect(percussionInstrument(127)).toBeUndefined();
  });

  it('lists each note once, in order, with a unique name', () => {
    expect(PERCUSSION_INSTRUMENTS.map(({ midi }) => midi)).toEqual(range(27, 87));
    expect(new Set(PERCUSSION_INSTRUMENTS.map(({ name }) => name)).size).toBe(
      PERCUSSION_INSTRUMENTS.length,
    );
  });

  it('keeps every default within two ledger lines of the staff', () => {
    for (const { staffPosition } of PERCUSSION_INSTRUMENTS) {
      expect(staffPosition).toBeGreaterThanOrEqual(-4);
      expect(staffPosition).toBeLessThanOrEqual(12);
    }
  });
});
