import { ScoreSchema, midiNote, stringInstrumentOf, validateScore } from '@reprise/model';
import { beatOf, noteOf } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { readGp3To5 } from '../src/index';
import { buildGpFile } from './gp-file';
import type { BeatSpec, BuildVersion } from './gp-file';

const VERSIONS: BuildVersion[] = ['3.00', '4.00', '4.06', '5.00', '5.10'];
const quarter = (string: number, fret: number, extra: Partial<BeatSpec> = {}): BeatSpec => ({
  notes: [{ string, fret }],
  ...extra,
});

function read(bytes: Uint8Array) {
  const result = readGp3To5(bytes);
  expect(ScoreSchema.safeParse(result.score).success).toBe(true);
  return result;
}

describe.each(VERSIONS)('a hand-built v%s file', (version) => {
  it('reads its version, metadata, tempo and notes', () => {
    const {
      score,
      warnings,
      version: parsedVersion,
    } = read(
      buildGpFile({
        version,
        tempo: 96,
        tracks: [{}],
        bars: [[[[quarter(1, 0), quarter(6, 3), { rest: true }, quarter(2, 12)]]]],
      }),
    );
    expect(parsedVersion).toBe(Number(version.replace('.', '')));
    expect(score.meta.title).toBe('Built');
    expect(score.masterBars[0]?.tempo?.bpm).toBe(96);
    const beats = score.tracks[0]?.bars[0]?.voices[0].beats ?? [];
    expect(
      beats.map((beat) => [beat.rest, beat.notes.map((note) => [note.string, note.fret])]),
    ).toEqual([
      [false, [[1, 0]]],
      [false, [[6, 3]]],
      [true, []],
      [false, [[2, 12]]],
    ]);
    expect(warnings.filter((warning) => warning.severity !== 'info')).toEqual([]);
  });

  it('reads a tempo change on a beat as a mixer change', () => {
    const { score } = read(
      buildGpFile({
        version,
        tracks: [{}],
        bars: [[[[quarter(1, 0), quarter(1, 2, { tempo: { bpm: 140, duration: 2 } })]]]],
      }),
    );
    expect(beatOf(score, 0, 0, 1).mix).toEqual({ tempo: { bpm: 140, duration: 2 } });
    expect(beatOf(score, 0, 0, 0).mix).toBeUndefined();
  });

  it('copies a tied note its origin fret and moves hammer-ons to the destination', () => {
    const { score, warnings } = read(
      buildGpFile({
        version,
        tracks: [{}],
        masterBars: 2,
        bars: [
          [[[{ notes: [{ string: 3, fret: 5, effects: 0x02 }] }, quarter(3, 7)]]],
          [
            [
              [
                { notes: [{ string: 3, fret: 0, tie: true }] },
                { notes: [{ string: 4, fret: 0, tie: true }] },
              ],
            ],
          ],
        ],
      }),
    );
    expect(noteOf(score, 0, 0, 1).hammerPull).toBe(true);
    expect(noteOf(score, 0, 0, 0).hammerPull).toBe(false);
    expect(noteOf(score, 0, 1, 0)).toMatchObject({ tie: true, fret: 7 });
    expect(noteOf(score, 0, 1, 1)).toMatchObject({ tie: false, fret: 0 });
    expect(warnings.map((warning) => warning.code)).toContain('tie-without-origin');
  });

  it('turns a keyboard track into a pitched one, keeping its tuning', () => {
    const { score } = read(
      buildGpFile({
        version,
        programs: { 1: 0 },
        tracks: [{ name: 'Piano', capo: 2, staffFlags: 0x02 }],
        bars: [
          [
            [
              [
                {
                  notes: [
                    { string: 1, fret: 0 },
                    { string: 6, fret: 3 },
                  ],
                },
              ],
            ],
          ],
        ],
      }),
    );
    const track = score.tracks[0];
    expect(track).toMatchObject({
      kind: 'pitched',
      tuning: [40, 45, 50, 55, 59, 64],
      capo: 2,
      program: 0,
      display: { notation: 'standard', octaveShift: 0 },
    });
    // Open high E plus the capo, and the low E's third fret plus the capo.
    expect(beatOf(score, 0, 0, 0).notes.map((note) => [note.string, note.fret])).toEqual([
      [0, 66],
      [0, 45],
    ]);
    if (track) expect(midiNote(track, noteOf(score, 0, 0, 0))).toBe(66);
  });

  it('reads the percussion channel as drums', () => {
    const { score } = read(
      buildGpFile({
        version,
        tracks: [{ channel: 10 }],
        bars: [[[[{ notes: [{ string: 5, fret: 36 }] }]]]],
      }),
    );
    expect(score.tracks[0]).toMatchObject({ kind: 'drums', tuning: [], fretCount: 0, capo: 0 });
    expect(noteOf(score, 0, 0, 0)).toMatchObject({ string: 0, fret: 36 });
  });

  it('skips a string bit the track lacks without reading a note block', () => {
    const { score, warnings } = read(
      buildGpFile({
        version,
        tracks: [{ strings: [64, 59, 55, 50] }],
        bars: [
          [
            [
              [
                {
                  notes: [
                    { string: 2, fret: 3 },
                    { string: 6, fret: 0, phantom: true },
                  ],
                },
                quarter(4, 5),
              ],
            ],
          ],
        ],
      }),
    );
    const beats = score.tracks[0]?.bars[0]?.voices[0].beats ?? [];
    expect(beats.map((beat) => beat.notes.map((note) => [note.string, note.fret]))).toEqual([
      [[2, 3]],
      [[4, 5]],
    ]);
    expect(warnings.filter((warning) => warning.severity !== 'info')).toMatchObject([
      { code: 'note-off-string', location: { beat: 0 } },
    ]);
  });

  it('reads the stroke speed byte as a 128th (1) down to a quarter (6)', () => {
    const { score } = read(
      buildGpFile({
        version,
        tracks: [{}],
        bars: [
          [
            [
              [
                quarter(1, 0, { effects: { stroke: { direction: 'down', speed: 1 } } }),
                quarter(1, 0, { effects: { stroke: { direction: 'up', speed: 3 } } }),
                quarter(1, 0, { effects: { stroke: { direction: 'up', speed: 6 } } }),
              ],
            ],
          ],
        ],
      }),
    );
    const beats = score.tracks[0]?.bars[0]?.voices[0].beats ?? [];
    expect(beats.map((beat) => beat.effects.brush)).toEqual([
      { direction: 'down', duration: 128 },
      { direction: 'up', duration: 32 },
      { direction: 'up', duration: 4 },
    ]);
  });

  it('puts the beat vibrato bit on the notes and keeps wide vibrato on the beat', () => {
    // GP3 has no note-level vibrato; GP4 and GP5 set beat bit 0x01 next to the note's own flag.
    const noteVibrato = version >= '4.00' ? { effects2: 0x40 } : {};
    const { score } = read(
      buildGpFile({
        version,
        tracks: [{}],
        bars: [
          [
            [
              [
                { notes: [{ string: 1, fret: 0, ...noteVibrato }], effects: { flags: 0x01 } },
                { notes: [{ string: 1, fret: 0 }], effects: { flags: 0x02 } },
                quarter(1, 0),
              ],
            ],
          ],
        ],
      }),
    );
    const beats = score.tracks[0]?.bars[0]?.voices[0].beats ?? [];
    expect(beats.map((beat) => [beat.effects.vibrato, beat.notes[0]?.vibrato])).toEqual([
      [undefined, 'slight'],
      ['wide', 'none'],
      [undefined, 'none'],
    ]);
  });

  it('reads a grace note at fret -1 as a dead one', () => {
    const { score, warnings } = read(
      buildGpFile({
        version,
        tracks: [{}],
        bars: [
          [
            [
              [
                { notes: [{ string: 1, fret: 5, grace: { fret: -1, duration: 2 } }] },
                { notes: [{ string: 1, fret: 5, grace: { fret: 3, transition: 3, duration: 3 } }] },
              ],
            ],
          ],
        ],
      }),
    );
    const beats = score.tracks[0]?.bars[0]?.voices[0].beats ?? [];
    expect(beats[0]?.grace).toEqual([
      { duration: 32, before: true, notes: [expect.objectContaining({ dead: true, fret: 0 })] },
    ]);
    expect(beats[1]?.grace).toEqual([
      { duration: 16, before: true, notes: [expect.objectContaining({ dead: false, fret: 3 })] },
    ]);
    expect(noteOf(score, 0, 0, 1).hammerPull).toBe(true);
    expect(warnings.filter((warning) => warning.severity !== 'info')).toEqual([]);
  });

  it('keeps a held note tied under a melody across a bar line', () => {
    const { score, warnings } = read(
      buildGpFile({
        version,
        tracks: [{}],
        masterBars: 2,
        bars: [
          [
            [
              [
                {
                  notes: [
                    { string: 6, fret: 5 },
                    { string: 2, fret: 1 },
                  ],
                },
                quarter(2, 3),
                quarter(1, 0),
              ],
            ],
          ],
          [
            [
              [
                {
                  notes: [
                    { string: 6, fret: 0, tie: true },
                    { string: 2, fret: 5 },
                  ],
                },
                quarter(2, 3),
                { notes: [{ string: 6, fret: 0, tie: true }] },
              ],
            ],
          ],
        ],
      }),
    );
    const held = (beat: number) => beatOf(score, 0, 1, beat).notes.find((n) => n.string === 6);
    expect(held(0)).toMatchObject({ fret: 5, tie: true });
    expect(held(2)).toMatchObject({ fret: 5, tie: true });
    expect(warnings.filter((warning) => warning.severity !== 'info')).toEqual([]);
    expect(validateScore(score)).toEqual([]);
  });

  it('reads a chord diagram with barres', () => {
    const { score } = read(
      buildGpFile({
        version,
        tracks: [{}],
        bars: [
          [
            [
              [
                quarter(1, 1, {
                  chord: {
                    name: 'F',
                    firstFret: 1,
                    frets: [1, 1, 2, 3, 3, 1],
                    barres: [{ fret: 1, start: 1, end: 6 }],
                  },
                }),
              ],
            ],
          ],
        ],
      }),
    );
    expect(beatOf(score, 0, 0, 0).chord).toEqual({
      name: 'F',
      diagram: {
        baseFret: 1,
        frets: [1, 1, 2, 3, 3, 1],
        barres: [{ fret: 1, firstString: 1, lastString: 6 }],
      },
    });
  });
});

describe.each(['4.06', '5.10'] satisfies BuildVersion[])('lyrics in v%s', (version) => {
  it('fill the raw block and the played beats from the start bar', () => {
    const { score, warnings } = read(
      buildGpFile({
        version,
        lyrics: {
          track: 1,
          lines: [
            { startBar: 1, text: 'Hel-lo  world [chorus]\r\nla+la' },
            { startBar: 2, text: 'two' },
          ],
        },
        masterBars: 2,
        tracks: [{}],
        bars: [
          [[[quarter(1, 0), { rest: true }, quarter(1, 1), quarter(1, 2)]]],
          [[[quarter(1, 3), quarter(1, 4), quarter(1, 5)]]],
        ],
      }),
    );
    const track = score.tracks[0];
    expect(track?.lyrics).toEqual([
      { startBar: 0, text: 'Hel-lo  world [chorus]\r\nla+la' },
      { startBar: 1, text: 'two' },
      { startBar: 0, text: '' },
      { startBar: 0, text: '' },
      { startBar: 0, text: '' },
    ]);
    const lyrics = track?.bars.flatMap((bar) =>
      bar.voices[0].beats.map((beat) => beat.lyrics?.slice(0, 2)),
    );
    expect(lyrics).toEqual([
      ['Hel-', ''],
      undefined,
      ['lo', ''],
      ['', ''],
      ['world', 'two'],
      ['la la', ''],
      undefined,
    ]);
    expect(warnings.filter((warning) => warning.code === 'lyrics-unplaced')).toEqual([]);
  });

  it('report syllables that run past the last played beat', () => {
    const { warnings } = read(
      buildGpFile({
        version,
        lyrics: { track: 1, lines: [{ startBar: 1, text: 'one two three' }] },
        tracks: [{}],
        bars: [[[[quarter(1, 0)]]]],
      }),
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: 'lyrics-unplaced', severity: 'warning' }),
    );
  });
});

describe.each(VERSIONS)('a 12-string flagged track in a v%s file', (version) => {
  const twelve = (track: { strings?: number[]; percussion?: boolean; flags?: number }) =>
    read(
      buildGpFile({
        version,
        tracks: [{ name: 'Twelve', ...track }],
        bars: [[[[quarter(1, 0)]]]],
      }),
    );

  // The flag's meaning is unverified against Guitar Pro itself (#348); this pins the reader's reading.
  it('doubles every course but the two highest, an octave up, and leaves those two unison', () => {
    const { score } = twelve({ flags: 0x02 });
    expect(score.tracks[0]?.courses).toEqual([12, 12, 12, 12, 0, 0]);
    const [track] = score.tracks;
    expect(track && stringInstrumentOf(track)).toBe('twelveString');
  });

  it('lays the courses over any string count', () => {
    expect(twelve({ flags: 0x02, strings: [64, 59, 55, 50] }).score.tracks[0]?.courses).toEqual([
      12, 12, 0, 0,
    ]);
    expect(
      twelve({ flags: 0x02, strings: [64, 59, 55, 50, 45, 40, 35] }).score.tracks[0]?.courses,
    ).toHaveLength(7);
  });

  it('leaves a plain track and a drum track single', () => {
    expect(twelve({}).score.tracks[0]?.courses).toBeUndefined();
    expect(twelve({ percussion: true, flags: 0x02 }).score.tracks[0]?.courses).toBeUndefined();
  });

  it('no longer reports the 12-string flag as dropped', () => {
    const { warnings } = twelve({ flags: 0x02 });
    // Only a GP5 file reports its missing multi-track flag; the 12-string flag adds nothing.
    const count = warnings.find((warning) => warning.code === 'track-flags-dropped')?.count;
    expect(count).toBe(version >= '5' ? 1 : undefined);
  });
});

describe('a GP5 track asking for tab', () => {
  const piano = (staffFlags: number, program = 0) =>
    read(
      buildGpFile({
        version: '5.10',
        programs: { 1: program },
        tracks: [{ name: 'Piano', staffFlags }],
        bars: [[[[quarter(1, 0)]]]],
      }),
    );

  it.each([
    [0x01, 'tab'],
    [0x03, 'both'],
  ])('keeps its strings when the flags are %i, as the file asks', (flags, notation) => {
    const { score, warnings, implicitNotation } = piano(flags);
    expect(score.tracks[0]).toMatchObject({
      kind: 'fretted',
      display: { notation, octaveShift: 0 },
    });
    expect(implicitNotation).toEqual([]);
    // The note stays on its string rather than becoming a MIDI pitch on string 0.
    expect(noteOf(score, 0, 0, 0)).toMatchObject({ string: 1, fret: 0 });
    // Warnings fold by code and keep the first message, so the count tells them apart: the
    // hand-built track lacks the multi-track flag, the one occurrence left once the tablature one is gone.
    expect(warnings.find((warning) => warning.code === 'track-flags-dropped')?.count).toBe(1);
  });

  it('stays pitched in standard when only the standard flag is set', () => {
    const { score, implicitNotation } = piano(0x02);
    expect(score.tracks[0]).toMatchObject({ kind: 'pitched', display: { notation: 'standard' } });
    expect(implicitNotation).toEqual([]);
  });

  it('keeps standard on a voice program when the file says standard', () => {
    const { score, implicitNotation } = piano(0x02, 53);
    expect(score.tracks[0]).toMatchObject({ kind: 'pitched', display: { notation: 'standard' } });
    expect(implicitNotation).toEqual([]);
  });

  it('does not report a guitar with both flags as implicit', () => {
    const { score, implicitNotation } = piano(0x03, 25);
    expect(score.tracks[0]).toMatchObject({ kind: 'fretted', display: { notation: 'both' } });
    expect(implicitNotation).toEqual([]);
  });

  it('still drops the tab flag on a drum track, with a second info', () => {
    const { warnings } = read(
      buildGpFile({
        version: '5.10',
        tracks: [{ name: 'Kit', percussion: true, staffFlags: 0x01 }],
        bars: [[[[quarter(1, 0)]]]],
      }),
    );
    expect(warnings).toContainEqual(
      expect.objectContaining({
        code: 'track-flags-dropped',
        count: 2,
      }),
    );
  });
});

describe.each(VERSIONS)('a vocal track in a v%s file with no notation instruction', (version) => {
  const vocals = [
    { label: 'voice program', program: 53, name: 'Lead' },
    { label: 'name', program: 0, name: 'Vocals' },
  ];
  it.each(vocals)('keeps its strings on a $label', ({ program, name }) => {
    const { score, implicitNotation } = read(
      buildGpFile({
        version,
        programs: { 1: program },
        tracks: [{ name, staffFlags: 0 }],
        bars: [[[[quarter(2, 5)]]]],
      }),
    );
    const track = score.tracks[0];
    expect(track).toMatchObject({ kind: 'fretted', display: { notation: 'tab', octaveShift: 0 } });
    expect(noteOf(score, 0, 0, 0)).toMatchObject({ string: 2, fret: 5 });
    expect(implicitNotation).toEqual(track ? [track.id] : []);
  });

  it('reports a keyboard track with no instruction as implicit and pitched', () => {
    const { score, implicitNotation } = read(
      buildGpFile({
        version,
        programs: { 1: 0 },
        tracks: [{ name: 'Piano', staffFlags: 0 }],
        bars: [[[[quarter(1, 0)]]]],
      }),
    );
    expect(score.tracks[0]).toMatchObject({ kind: 'pitched' });
    expect(implicitNotation).toHaveLength(score.tracks.length);
  });
});

describe('GP5 voices', () => {
  it('read the second voice block into voice 2', () => {
    const { score } = read(
      buildGpFile({
        version: '5.10',
        tracks: [{}],
        bars: [
          [
            [
              [quarter(1, 0, { duration: -2 })],
              [quarter(6, 0, { duration: -1 }), quarter(6, 2, { duration: -1 })],
            ],
          ],
        ],
      }),
    );
    const voices = score.tracks[0]?.bars[0]?.voices;
    expect(voices?.map((voice) => voice.beats.length)).toEqual([1, 2, 0, 0]);
    expect(voices?.[1].beats.map((beat) => [beat.duration, beat.notes[0]?.fret])).toEqual([
      [2, 0],
      [2, 2],
    ]);
  });

  it('spell a note with swapped accidentals as its enharmonic', () => {
    const { score } = read(
      buildGpFile({
        version: '5.10',
        tracks: [{}],
        bars: [[[[{ notes: [{ string: 2, fret: 2, flags2: 0x02 }] }, quarter(2, 2)]]]],
      }),
    );
    // C#4 in C major is spelled with a sharp by default; swapped, it is Db.
    expect(noteOf(score, 0, 0, 0).accidental).toBe('flat');
    expect(noteOf(score, 0, 0, 1).accidental).toBeUndefined();
  });
});

describe('GP3 and GP4 alternate endings', () => {
  it('store a count that the reader turns into bracket numbers', () => {
    // Repeat start, "1." closing the repeat, "2.": GP4 writes the counts 1 and 2.
    const bytes = buildGpFile({
      version: '4.06',
      masterBars: 3,
      tracks: [{}],
      bars: [[[[]]], [[[]]], [[[]]]],
    });
    const { score } = read(
      patchMasterBars(bytes, [0x03 | 0x04, 0x10 | 0x08, 0x10], [[4, 4], [1, 1], [2]]),
    );
    expect(score.masterBars.map((bar) => bar.alternateEndings)).toEqual([[], [1], [2]]);
    expect(score.masterBars.map((bar) => bar.repeat)).toEqual([
      { start: true, endCount: 0 },
      { start: false, endCount: 2 },
      { start: false, endCount: 0 },
    ]);
  });
});

/**
 * Rewrites a GP3/GP4 file's master bars, which `buildGpFile` writes as the first 3 bytes (4/4)
 * then one zero byte per bar, right after the bar and track counts.
 */
function patchMasterBars(bytes: Uint8Array, flags: number[], payloads: number[][]): Uint8Array {
  const start = findMasterBars(bytes, flags.length);
  const rebuilt = flags.flatMap((flag, i) => [flag, ...(payloads[i] ?? [])]);
  const before = bytes.subarray(0, start);
  const after = bytes.subarray(start + 3 + (flags.length - 1));
  return Uint8Array.from([...before, ...rebuilt, ...after]);
}

function findMasterBars(bytes: Uint8Array, count: number): number {
  for (let i = 0; i + 8 < bytes.length; i++) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + i);
    if (view.getInt32(0, true) === count && view.getInt32(4, true) === 1 && bytes[i + 8] === 0x03)
      return i + 8;
  }
  throw new Error('master bars not found');
}
