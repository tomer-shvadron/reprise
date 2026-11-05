import { ScoreSchema, parseNative, serializeNative, validateScore } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { readGp3To5 } from '../src/index';
import { countNotes, featuresOf, fixtureBytes, manifestEntries } from './corpus';

const entries = manifestEntries(['gp3', 'gp4', 'gp5']);
const APP = { name: 'reprise-tests', version: '0.0.0' };

describe('gp3, gp4 and gp5 fixtures', () => {
  it('covers every binary fixture in the manifest', () => {
    expect(entries.map((entry) => entry.format).sort()).toEqual([
      ...Array<string>(3).fill('gp3'),
      ...Array<string>(4).fill('gp4'),
      ...Array<string>(8).fill('gp5'),
    ]);
  });

  describe.each(entries)('$path', (entry) => {
    const result = readGp3To5(fixtureBytes(entry.path));
    const { score, warnings } = result;

    it('reads as its own format with no errors', () => {
      expect(result.format).toBe(entry.format);
      expect(warnings.filter((warning) => warning.severity === 'error')).toEqual([]);
    });

    it('has the manifest counts', () => {
      expect({
        tracks: score.tracks.length,
        bars: score.masterBars.length,
        notes: countNotes(score),
      }).toEqual({ tracks: entry.tracks, bars: entry.bars, notes: entry.notes });
    });

    it('shows exactly the manifest features', () => {
      expect([...featuresOf(score)].sort()).toEqual([...entry.features].sort());
    });

    it('is schema-valid, with every invariant violation reported as a warning', () => {
      expect(ScoreSchema.safeParse(score).success).toBe(true);
      const reported = warnings.filter((warning) => warning.location.path !== undefined);
      expect(reported.map((warning) => warning.code)).toEqual(
        validateScore(score).map((violation) => violation.rule),
      );
    });

    it('round-trips losslessly through the native format', () => {
      const parsed = parseNative(serializeNative(score, APP));
      expect(parsed.score).toEqual(score);
      expect(parsed.warnings.filter((warning) => warning.code === 'unknown-field')).toEqual([]);
    });
  });
});

describe('what the fixtures carry', () => {
  const read = (path: string) => readGp3To5(fixtureBytes(path)).score;

  it('propagates GP5 voltas through the bar that closes the repeat', () => {
    const { masterBars } = read('gp5/repeat-close-alternate-endings.gp5');
    expect(masterBars.map((bar) => bar.alternateEndings)).toEqual([[], [1, 3], [2], [2], []]);
    expect(masterBars.map((bar) => bar.repeat)).toEqual([
      { start: true, endCount: 0 },
      { start: false, endCount: 0 },
      { start: false, endCount: 0 },
      { start: false, endCount: 4 },
      { start: false, endCount: 0 },
    ]);
  });

  it('reads every GP5 direction onto its bar', () => {
    const { masterBars } = read('gp5/directions.gp5');
    expect(masterBars.slice(0, 5).map((bar) => bar.targets)).toEqual([
      ['coda'],
      ['doubleCoda'],
      ['segno'],
      ['segnoSegno'],
      ['fine'],
    ]);
    expect(masterBars.slice(5).map((bar) => bar.jumps.map((jump) => jump.kind))).toEqual([
      ['daCapo'],
      ['dcAlCoda'],
      ['dcAlDoubleCoda'],
      ['dcAlFine'],
      ['dalSegno'],
      ['dalSegnoSegno'],
      ['dsAlCoda'],
      ['dsAlDoubleCoda'],
      ['dssAlCoda'],
      ['dssAlDoubleCoda'],
      ['dsAlFine'],
      ['dssAlFine'],
      ['toCoda'],
      ['toDoubleCoda'],
    ]);
  });

  it('reverses tuning to lowest string first and picks the bass clef for low strings', () => {
    const { tracks } = read('gp5/bass-tuning.gp5');
    expect(tracks.map((track) => [track.tuning, track.display.clef])).toEqual([
      [[40, 45, 50, 55, 59, 64], 'treble'],
      [[23, 28, 33, 38, 43, 48], 'bass'],
      [[28, 33, 38, 43], 'bass'],
      [[34, 45, 50, 55, 59, 64], 'bass'],
    ]);
  });

  it('maps the GP5 staff flags onto the notation', () => {
    expect(read('gp5/staves.gp5').tracks.map((track) => track.display.notation)).toEqual([
      'both',
      'standard',
      'tab',
    ]);
  });

  it('reads track colours and scales the mixer to MIDI units', () => {
    const { tracks } = read('gp4/colors.gp4');
    expect(tracks.map((track) => track.color)).toEqual([
      '#ff0000',
      '#00ff00',
      '#ffff00',
      '#0000ff',
    ]);
    expect(tracks[0]?.channel).toMatchObject({ volume: 104, pan: 64 });
  });

  it('reads chord diagrams with barres and fingering', () => {
    const chord = read('gp5/chords.gp5').tracks[0]?.bars[0]?.voices[0].beats[2]?.chord;
    expect(chord).toEqual({
      name: 'C',
      diagram: {
        baseFret: 1,
        frets: [3, 5, 5, 5, 3, null],
        barres: [{ fret: 3, firstString: 1, lastString: 5 }],
        fingering: ['index', 'little', 'ring', 'middle', 'index', null],
      },
    });
  });

  it('keeps GM percussion notes as MIDI values on string 0', () => {
    const track = read('gp5/percussion-all.gp5').tracks[0];
    expect(track?.kind).toBe('drums');
    const notes =
      track?.bars.flatMap((bar) =>
        bar.voices.flatMap((voice) => voice.beats.flatMap((beat) => beat.notes)),
      ) ?? [];
    expect(notes.every((note) => note.string === 0)).toBe(true);
    expect(notes.map((note) => note.fret)).toContain(27);
  });

  it.each(['gp3/effects.gp3', 'gp4/effects.gp4', 'gp5/effects.gp5'])(
    'moves the hammer-on flag of %s onto the destination note',
    (path) => {
      const beats = read(path).tracks[0]?.bars[5]?.voices[0].beats ?? [];
      expect(beats.map((beat) => beat.notes.map((note) => note.hammerPull))).toEqual([
        [false, false],
        [true, true],
        [true, false],
        [false],
        [true],
      ]);
    },
  );

  it('reads the GP3 tremolo-bar dip the way GP4 writes it', () => {
    const gp3 = read('gp3/effects.gp3').tracks[0]?.bars[8]?.voices[0].beats[0];
    const gp4 = read('gp4/effects.gp4').tracks[0]?.bars[8]?.voices[0].beats[0];
    expect(gp3?.effects.whammy?.points).toEqual(gp4?.effects.whammy?.points);
  });
});
