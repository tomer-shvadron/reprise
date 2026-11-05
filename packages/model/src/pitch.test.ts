import { describe, expect, it } from 'vitest';

import { createNote, createTrack } from './factories';
import type { Note } from './note';
import { midiNote, openStringPitch, transpose } from './pitch';
import type { TransposeResult } from './pitch';
import { STANDARD_TUNINGS } from './tunings';

const guitar = (capo = 0, fretCount = 24) => createTrack('fretted', { capo, fretCount });

describe('midiNote', () => {
  const cases = STANDARD_TUNINGS.flatMap(({ name, strings }) =>
    [0, 7].flatMap((capo) =>
      [0, 24].flatMap((fret) =>
        strings.map((open, index) => ({
          name,
          tuning: [...strings],
          string: strings.length - index,
          capo,
          fret,
          expected: open + capo + fret,
        })),
      ),
    ),
  );

  it.each(cases)(
    '$name string $string, capo $capo, fret $fret is $expected',
    ({ tuning, string, capo, fret, expected }) => {
      const track = createTrack('fretted', { tuning, capo });
      expect(midiNote(track, createNote({ string, fret }))).toBe(expected);
    },
  );

  it.each([
    { string: 1, fret: 0, capo: 0, expected: 64 },
    { string: 6, fret: 0, capo: 0, expected: 40 },
    { string: 3, fret: 5, capo: 0, expected: 60 },
    { string: 1, fret: 24, capo: 0, expected: 88 },
    { string: 6, fret: 0, capo: 7, expected: 47 },
    { string: 1, fret: 24, capo: 7, expected: 95 },
  ])(
    'E standard string $string fret $fret capo $capo is MIDI $expected',
    ({ string, fret, capo, expected }) => {
      expect(midiNote(guitar(capo), createNote({ string, fret }))).toBe(expected);
    },
  );

  it('returns the stored MIDI note on drum and pitched tracks, even with a tuning', () => {
    const note = createNote({ string: 0, fret: 38 });
    expect(midiNote(createTrack('drums'), note)).toBe(38);
    expect(midiNote(createTrack('pitched'), note)).toBe(38);
    expect(midiNote(createTrack('pitched', { tuning: [40, 45, 50], capo: 3 }), note)).toBe(38);
  });

  it('throws on a string the track does not have', () => {
    expect(() => midiNote(guitar(), createNote({ string: 7, fret: 0 }))).toThrow(RangeError);
    expect(() => midiNote(guitar(), createNote({ string: 0, fret: 0 }))).toThrow(RangeError);
  });

  it('reads open strings in Track.tuning order', () => {
    expect(openStringPitch(guitar(), 1)).toBe(64);
    expect(openStringPitch(guitar(), 6)).toBe(40);
    expect(openStringPitch(guitar(), 7)).toBeUndefined();
  });
});

function moved(result: TransposeResult): Note {
  if (!result.ok) throw new Error(`expected a transposed note, got ${result.reason}`);
  return result.note;
}

describe('transpose', () => {
  it.each([
    { name: 'open string up', capo: 0, string: 1, fret: 0, by: 3, to: 3 },
    { name: 'down to the open string', capo: 0, string: 6, fret: 5, by: -5, to: 0 },
    { name: 'up to fret 24', capo: 0, string: 2, fret: 12, by: 12, to: 24 },
    { name: 'fret 24 down', capo: 0, string: 2, fret: 24, by: -24, to: 0 },
    { name: 'capo 7, up to fret 17', capo: 7, string: 3, fret: 10, by: 7, to: 17 },
    { name: 'capo 7, up to the last fret', capo: 7, string: 3, fret: 17, by: 7, to: 24 },
    { name: 'capo 7, open string', capo: 7, string: 3, fret: 0, by: 0, to: 0 },
  ])('$name: fret $fret by $by is fret $to', ({ capo, string, fret, by, to }) => {
    const track = guitar(capo);
    const note = createNote({ string, fret });
    const result = moved(transpose(track, note, by));
    expect(result).toMatchObject({ string, fret: to });
    expect(midiNote(track, result)).toBe(midiNote(track, note) + by);
  });

  it.each([
    {
      name: 'below the open string',
      capo: 0,
      string: 6,
      fret: 0,
      by: -1,
      reason: 'belowOpenString',
    },
    { name: 'above fret 24', capo: 0, string: 1, fret: 24, by: 1, reason: 'aboveLastFret' },
    {
      name: 'past the last fret with capo 7',
      capo: 7,
      string: 1,
      fret: 24,
      by: 1,
      reason: 'aboveLastFret',
    },
    { name: 'below the capo', capo: 7, string: 2, fret: 0, by: -2, reason: 'belowOpenString' },
  ] as const)('$name reports $reason', ({ capo, string, fret, by, reason }) => {
    const track = guitar(capo);
    const note = createNote({ string, fret });
    expect(transpose(track, note, by)).toMatchObject({
      ok: false,
      reason,
      midi: midiNote(track, note) + by,
    });
  });

  it('offers the other strings that can play a pitch that fell off', () => {
    const result = transpose(guitar(), createNote({ string: 5, fret: 0 }), -1);
    expect(result).toEqual({
      ok: false,
      reason: 'belowOpenString',
      midi: 44,
      alternatives: [{ string: 6, fret: 4 }],
    });
  });

  it('has no alternatives when the pitch is lower than every string', () => {
    const result = transpose(guitar(), createNote({ string: 6, fret: 0 }), -1);
    expect(result).toMatchObject({ ok: false, alternatives: [] });
  });

  it('honours a short neck', () => {
    const result = transpose(guitar(0, 20), createNote({ string: 1, fret: 19 }), 2);
    expect(result).toMatchObject({ ok: false, reason: 'aboveLastFret' });
  });

  it('moves pitched notes as MIDI and stops at the MIDI range', () => {
    const piano = createTrack('pitched');
    expect(moved(transpose(piano, createNote({ string: 0, fret: 60 }), 7)).fret).toBe(67);
    expect(transpose(piano, createNote({ string: 0, fret: 127 }), 1)).toEqual({
      ok: false,
      reason: 'outOfMidiRange',
      midi: 128,
      alternatives: [],
    });
    expect(transpose(piano, createNote({ string: 0, fret: 0 }), -1)).toMatchObject({
      ok: false,
      reason: 'outOfMidiRange',
    });
  });

  it('leaves drum notes alone', () => {
    const note = createNote({ string: 0, fret: 38 });
    expect(transpose(createTrack('drums'), note, 5)).toEqual({ ok: true, note, warnings: [] });
  });

  it('warns when a natural harmonic moves and leaves its value alone', () => {
    const natural = createNote({ string: 1, fret: 12, harmonic: { kind: 'natural', value: 12 } });
    expect(transpose(guitar(), natural, 2)).toEqual({
      ok: true,
      note: { ...natural, fret: 14 },
      warnings: ['naturalHarmonicMoved'],
    });
    expect(transpose(guitar(), natural, 0)).toMatchObject({ ok: true, warnings: [] });
    const artificial = createNote({
      string: 1,
      fret: 5,
      harmonic: { kind: 'artificial', value: 12 },
    });
    expect(transpose(guitar(), artificial, 2)).toMatchObject({
      ok: true,
      note: { fret: 7, harmonic: { kind: 'artificial', value: 12 } },
      warnings: [],
    });
  });

  it('keeps a stored accidental only across octaves', () => {
    const note = createNote({ string: 2, fret: 2, accidental: 'flat' });
    expect(moved(transpose(guitar(), note, 12)).accidental).toBe('flat');
    expect(moved(transpose(guitar(), note, 1))).not.toHaveProperty('accidental');
  });

  it('moves the trill with the note and drops it when it falls off', () => {
    const note = createNote({ string: 1, fret: 20, trill: { fret: 22, speed: 16 } });
    const up = transpose(guitar(), note, 2);
    expect(up).toMatchObject({ ok: true, warnings: [], note: { fret: 22, trill: { fret: 24 } } });
    const further = transpose(guitar(), note, 3);
    expect(further).toMatchObject({ ok: true, warnings: ['trillDropped'], note: { fret: 23 } });
    expect(moved(further)).not.toHaveProperty('trill');
  });

  it('keeps every other property and returns a new note', () => {
    const note = createNote({ string: 3, fret: 5, palmMute: true, dynamics: 'pp' });
    const result = moved(transpose(guitar(), note, 2));
    expect(result).toEqual({ ...note, fret: 7 });
    expect(note.fret).toBe(5);
  });

  it('rejects fractional semitones', () => {
    expect(() => transpose(guitar(), createNote({ string: 1, fret: 0 }), 0.5)).toThrow(RangeError);
  });
});
