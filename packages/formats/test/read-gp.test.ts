import { parseNative, serializeNative } from '@reprise/model';
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { GpError, GpifError, readGp } from '../src/index';
import { countNotes, featuresOf, fixtureBytes, manifestEntries } from './corpus';

const APP = { name: 'reprise-test', version: '0.0.0' };

describe('readGp on the fixture corpus', () => {
  const entries = manifestEntries(['gp']);

  it('covers every gp fixture in the manifest', () => {
    expect(entries.map((entry) => entry.path).sort()).toEqual([
      'gp/beat-lyrics.gp',
      'gp/beat-tempo-change.gp',
      'gp/drum-tabs.gp',
      'gp/multivoice-rhythm.gp',
      'gp/sustain.gp',
      'gp/timer.gp',
      'gp/track-volume.gp',
    ]);
  });

  describe.each(entries)('$path', (entry) => {
    const { score, warnings } = readGp(fixtureBytes(entry.path));

    it('has the manifest counts of tracks, bars and notes', () => {
      expect(score.tracks).toHaveLength(entry.tracks);
      expect(score.masterBars).toHaveLength(entry.bars);
      expect(countNotes(score)).toBe(entry.notes);
    });

    it('shows the manifest features in the model', () => {
      expect([...featuresOf(score)].sort()).toEqual([...entry.features].sort());
    });

    it('reports nothing it does not recognise', () => {
      expect(warnings.filter((warning) => warning.code === 'unknown-element')).toEqual([]);
    });

    it('round-trips losslessly through the native format', () => {
      const parsed = parseNative(serializeNative(score, APP));
      expect(parsed.score).toEqual(score);
      expect(parsed.warnings.filter((warning) => warning.code === 'unknown-field')).toEqual([]);
    });
  });
});

describe('readGp on specific fixtures', () => {
  it('reads per-beat lyrics and keeps the raw block', () => {
    const { score } = readGp(fixtureBytes('gp/beat-lyrics.gp'));
    const track = score.tracks[0];
    expect(track?.lyrics[0]?.text).toBe(
      'Manually Modified to ensure beat lyrics are used [with comments]',
    );
    const firstLine = track?.bars.flatMap((bar) =>
      bar.voices[0].beats.map((beat) => beat.lyrics?.[0]),
    );
    expect(firstLine).toEqual([
      'This',
      'is',
      'a',
      'test file',
      'for',
      'lyrics',
      undefined,
      undefined,
    ]);
  });

  it('reads tempo automations at bar starts and mid-bar', () => {
    const { score, warnings } = readGp(fixtureBytes('gp/beat-tempo-change.gp'));
    expect(score.masterBars.map((bar) => bar.tempo?.bpm)).toEqual([120, 100, 121, 121]);
    const midBar = score.tracks[0]?.bars.map((bar) =>
      bar.voices[0].beats.flatMap((beat) => (beat.mix?.tempo ? [beat.mix.tempo.bpm] : [])),
    );
    expect(midBar).toEqual([[60], [120], [120], [120, 121]]);
    expect(warnings.some((warning) => warning.code === 'tempo-moved')).toBe(true);
  });

  it('reads repeats, voltas and directions', () => {
    const { score } = readGp(fixtureBytes('gp/timer.gp'));
    const bars = score.masterBars;
    expect(bars[1]?.repeat).toEqual({ start: true, endCount: 0 });
    expect(bars[3]?.targets).toEqual(['fine']);
    expect(bars[4]?.alternateEndings).toEqual([1]);
    expect(bars[5]?.alternateEndings).toEqual([2, 3]);
    expect(bars[5]?.repeat).toEqual({ start: false, endCount: 3 });
    expect(bars[7]?.jumps).toEqual([{ kind: 'dcAlFine' }]);
  });

  it('reads a drum kit as drums with GM percussion notes', () => {
    const { score } = readGp(fixtureBytes('gp/drum-tabs.gp'));
    const track = score.tracks[0];
    expect(track?.kind).toBe('drums');
    expect(track?.tuning).toEqual([]);
    expect(track?.display.clef).toBe('percussion');
    const notes = track?.bars.flatMap((bar) =>
      bar.voices.flatMap((voice) => voice.beats.flatMap((beat) => beat.notes)),
    );
    expect(notes?.every((note) => note.string === 0 && note.fret >= 27 && note.fret <= 87)).toBe(
      true,
    );
  });

  it('reads a piano as a pitched track with MIDI notes', () => {
    const { score } = readGp(fixtureBytes('gp/sustain.gp'));
    const track = score.tracks[0];
    expect(track?.kind).toBe('pitched');
    expect(track?.display.notation).toBe('standard');
    expect(track?.bars[0]?.voices[0].beats[0]?.notes[0]).toMatchObject({ string: 0, fret: 67 });
  });

  it('reads track volume from the channel strip', () => {
    const { score } = readGp(fixtureBytes('gp/track-volume.gp'));
    expect(score.tracks.map((track) => track.channel.volume)).toEqual([
      127, 114, 102, 84, 61, 30, 1,
    ]);
    expect(score.tracks.every((track) => track.channel.pan === 64)).toBe(true);
  });

  it('reads tuplets and the octave transposition', () => {
    const { score } = readGp(fixtureBytes('gp/beat-tempo-change.gp'));
    const track = score.tracks[0];
    expect(track?.display.octaveShift).toBe(1);
    const tuplets = track?.bars.flatMap((bar) => bar.voices[0].beats.filter((beat) => beat.tuplet));
    expect(tuplets?.[0]?.tuplet).toEqual({ n: 3, of: 2 });
  });
});

describe('readGp errors', () => {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

  it('rejects bytes that are not a zip', () => {
    expect(() => readGp(encode('not a zip at all'))).toThrow(GpError);
    try {
      readGp(encode('not a zip at all'));
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-zip' });
    }
  });

  it('rejects a zip without Content/score.gpif', () => {
    const zip = zipSync({ 'Content/other.xml': encode('<x/>'), VERSION: encode('7.0') });
    expect(() => readGp(zip)).toThrow(expect.objectContaining({ code: 'missing-score' }));
  });

  it('refuses an entry whose declared size would allocate gigabytes', () => {
    const zip = zipSync({ 'Content/score.gpif': encode('<GPIF/>') });
    // The central directory's uncompressed size sits 24 bytes into its entry, after the
    // 0x02014b50 signature; the name starts at byte 46.
    const name = encode('Content/score.gpif');
    for (let at = 0; at + 46 + name.length <= zip.length; at++) {
      const signature = zip[at] === 0x50 && zip[at + 1] === 0x4b && zip[at + 2] === 0x01;
      if (!signature || zip[at + 3] !== 0x02) continue;
      if (!name.every((byte, index) => zip[at + 46 + index] === byte)) continue;
      new DataView(zip.buffer, zip.byteOffset).setUint32(at + 24, 0xff_ff_ff_fe, true);
    }
    expect(() => readGp(zip)).toThrow(expect.objectContaining({ code: 'too-large' }));
  });

  it('reports malformed XML with its position', () => {
    const zip = zipSync({ 'Content/score.gpif': encode('<GPIF>\n<Score>\n</GPIF>') });
    let caught: unknown;
    try {
      readGp(zip);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GpifError);
    expect(caught).toMatchObject({ code: 'invalid-xml', line: 3, column: 1 });
  });

  it('rejects a document whose root is not GPIF', () => {
    const zip = zipSync({ 'Content/score.gpif': encode('<Score/>') });
    expect(() => readGp(zip)).toThrow(expect.objectContaining({ code: 'not-gpif' }));
  });
});

describe('readGp timing', () => {
  it('reads the largest fixture well inside the import budget', () => {
    const bytes = fixtureBytes('gp/drum-tabs.gp');
    readGp(bytes);
    const runs = 20;
    const start = Date.now();
    for (let run = 0; run < runs; run++) readGp(bytes);
    const perRead = (Date.now() - start) / runs;
    // About 2 ms on a laptop; the bound leaves room for a slow CI runner.
    expect(perRead).toBeLessThan(100);
  });
});
