import { ScoreSchema, parseNative, serializeNative, type Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { GpifError, GpxError, readGp3To5, readGpx } from '../src/index';
import { countNotes, featuresOf, fixtureBytes, manifestEntries } from './corpus';

const entries = manifestEntries(['gpx']);
const APP = { name: 'reprise-test', version: '0.0.0' };

describe('readGpx on the fixture corpus', () => {
  it('covers every gpx fixture in the manifest', () => {
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      'gpx/chords.gpx',
      'gpx/effects.gpx',
      'gpx/key-signatures.gpx',
      'gpx/layout-configuration-multi-track-all.gpx',
      'gpx/repeat-close-alternate-endings.gpx',
    ]);
  });

  describe.each(entries)('$path', (entry) => {
    const result = readGpx(fixtureBytes(entry.path));
    const { score, warnings } = result;

    it('reads as gpx with the manifest counts of tracks, bars and notes', () => {
      expect(result.format).toBe('gpx');
      expect({
        tracks: score.tracks.length,
        bars: score.masterBars.length,
        notes: countNotes(score),
      }).toEqual({ tracks: entry.tracks, bars: entry.bars, notes: entry.notes });
    });

    it('shows exactly the manifest features', () => {
      expect([...featuresOf(score)].sort()).toEqual([...entry.features].sort());
    });

    it('is schema-valid and recognises every element', () => {
      expect(ScoreSchema.safeParse(score).success).toBe(true);
      expect(warnings.filter((warning) => warning.code === 'unknown-element')).toEqual([]);
    });

    it('round-trips losslessly through the native format', () => {
      const parsed = parseNative(serializeNative(score, APP));
      expect(parsed.score).toEqual(score);
      expect(parsed.warnings.filter((warning) => warning.code === 'unknown-field')).toEqual([]);
    });
  });
});

/**
 * Per bar and voice, each sounding beat's rhythm and each note's string, fret and tie. Rests are
 * left out: Guitar Pro 6 filled the bars Guitar Pro 5 left short with rests when it resaved them.
 */
function rhythmAndNotes(score: Score): unknown[] {
  return score.tracks.flatMap((track) =>
    track.bars.map((bar) =>
      bar.voices.map((voice) =>
        voice.beats.flatMap((beat) =>
          beat.notes.length === 0
            ? []
            : [
                [
                  beat.duration,
                  beat.dots,
                  beat.tuplet,
                  beat.notes.map((note) => [note.string, note.fret, note.tie]),
                ],
              ],
        ),
      ),
    ),
  );
}

describe('the same files saved by Guitar Pro 5 and 6', () => {
  it.each(['effects', 'key-signatures', 'repeat-close-alternate-endings'])(
    '%s reads to the same notes and bar structure',
    (name) => {
      const gpx = readGpx(fixtureBytes(`gpx/${name}.gpx`)).score;
      const gp5 = readGp3To5(fixtureBytes(`gp5/${name}.gp5`)).score;
      expect(rhythmAndNotes(gpx)).toEqual(rhythmAndNotes(gp5));
      const bars = (score: Score) =>
        score.masterBars.map(({ timeSignature, keySignature, repeat, alternateEndings }) => ({
          timeSignature,
          keySignature,
          repeat,
          alternateEndings,
        }));
      expect(bars(gpx)).toEqual(bars(gp5));
    },
  );
});

describe('readGpx on specific fixtures', () => {
  it('reads GP6 note accidentals', () => {
    const { score } = readGpx(fixtureBytes('gpx/chords.gpx'));
    const spelled = score.tracks[0]?.bars.flatMap((bar) =>
      bar.voices[0].beats.flatMap((beat) => beat.notes.flatMap((note) => note.accidental ?? [])),
    );
    expect(spelled).toEqual(['flat', 'flat', 'sharp', 'sharp']);
  });

  it('applies the part configuration to each track', () => {
    const { score } = readGpx(fixtureBytes('gpx/layout-configuration-multi-track-all.gpx'));
    expect(score.tracks.map((track) => track.display.notation)).toMatchInlineSnapshot(`
      [
        "both",
        "both",
        "both",
      ]
    `);
  });

  it('reads chord diagrams from the GP6 track properties', () => {
    const { score } = readGpx(fixtureBytes('gpx/chords.gpx'));
    const chords = score.tracks[0]?.bars.flatMap((bar) =>
      bar.voices[0].beats.flatMap((beat) => (beat.chord ? [beat.chord.name] : [])),
    );
    expect(chords?.length).toBeGreaterThan(0);
  });
});

/** mulberry32: a fixed seed keeps the fuzz cases the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('readGpx on damaged files', () => {
  it(
    'either reads a schema-valid score or throws GpxError or GpifError',
    { timeout: 30_000 },
    () => {
      const next = random(43);
      for (const entry of entries) {
        const original = fixtureBytes(entry.path);
        for (let run = 0; run < 40; run++) {
          const bytes = original.slice();
          const flips = 1 + Math.floor(next() * 4);
          for (let flip = 0; flip < flips; flip++) {
            const at = 8 + Math.floor(next() * (bytes.length - 8));
            bytes[at] = Math.floor(next() * 256);
          }
          try {
            expect(ScoreSchema.safeParse(readGpx(bytes).score).success).toBe(true);
          } catch (error) {
            if (!(error instanceof GpxError || error instanceof GpifError)) throw error;
          }
        }
      }
    },
  );
});

describe('readGpx timing', () => {
  it('reads the largest fixture well inside the import budget', { timeout: 30_000 }, () => {
    const bytes = fixtureBytes('gpx/effects.gpx');
    readGpx(bytes);
    const runs = 20;
    const start = Date.now();
    for (let run = 0; run < runs; run++) readGpx(bytes);
    const perRead = (Date.now() - start) / runs;
    // A few milliseconds on a laptop; the bound leaves room for a slow CI runner.
    expect(perRead).toBeLessThan(100);
  });
});
