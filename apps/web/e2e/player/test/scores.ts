/**
 * The scores the flows open: generated at global setup into `.generated/` (never committed), and
 * the committed fixtures, one per format. The song's facts were read off the app's readout.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { write } from '@reprise/formats';
import type { Notation, Score } from '@reprise/model';
import { fullScore, largeScore, note, score } from '@reprise/model/testing';

export const REPO = fileURLToPath(new URL('../../../../../', import.meta.url));
export const GENERATED = fileURLToPath(new URL('../.generated/', import.meta.url));
export const GM_BANK = `${REPO}apps/web/public/sounds/gm/GeneralUser-GS.sf2`;

export const generated = (name: string) => `${GENERATED}${name}`;
export const fixture = (path: string) => `${REPO}fixtures/${path}`;

/** Two guitar tracks of 16 bars at 90 BPM, 3/4 at bars 5, 10 and 15, bars 1–8 and 9–16 twice. */
export const SONG = {
  quarterMs: { 100: 60_000 / 90, 50: 120_000 / 90, 150: 40_000 / 90 },
  bar8First: '0:18',
  bar1Second: '0:20',
  bar2First: '0:02',
  bar2Second: '0:23',
  total: '/ 1:21',
  description: '16 bars, 3 pages',
  bars: 16,
} as const;

/** One committed fixture per format, each opened by a drop. */
export const FORMATS = [
  'gp3/notes.gp3',
  'gp4/notes.gp4',
  'gp5/chords.gp5',
  'gpx/chords.gpx',
  'gp/timer.gp',
];

interface ManifestEntry {
  path: string;
  tracks: number;
  bars: number;
  notes: number;
}

export function manifestEntry(path: string): ManifestEntry {
  const manifest = JSON.parse(readFileSync(fixture('manifest.json'), 'utf8')) as {
    fixtures: ManifestEntry[];
  };
  const entry = manifest.fixtures.find((candidate) => candidate.path === path);
  if (!entry) throw new Error(`fixtures/manifest.json has no ${path}`);
  return entry;
}

const NOTATIONS: Notation[] = ['tab', 'standard', 'both'];

/** The roadmap's reference long score, with each track's notation carried in the file. */
function longScore(): Score {
  const score = largeScore(8, 300, { structure: true });
  return {
    ...score,
    tracks: score.tracks.map((track, index) => ({
      ...track,
      display: { ...track.display, notation: NOTATIONS[index % 3] ?? 'tab' },
    })),
  };
}

/** Two tracks of 24 bars with sections Intro, Verse, Chorus, Verse, Chorus, Outro, four bars each. */
export const SECTIONS = {
  file: 'sections.reprise',
  bars: 24,
  tracks: ['Lead', 'Rhythm'],
  starts: { verse1: 5, chorus2: 17 },
  chorus2Bars: '17–20',
} as const;

function sectionsScore(): Score {
  const names = ['Intro', 'Verse', 'Chorus', 'Verse', 'Chorus', 'Outro'];
  const builder = score().tempo(120);
  for (const track of SECTIONS.tracks) {
    builder.track('guitar', { name: track });
    for (let bar = 0; bar < SECTIONS.bars; bar += 1) {
      builder.bar();
      const section = names[bar / 4];
      if (track === SECTIONS.tracks[0] && bar % 4 === 0 && section !== undefined) {
        builder.section(section);
      }
      for (let beat = 0; beat < 4; beat += 1) builder.beat('4', [note(1, (bar + beat) % 12)]);
    }
  }
  return builder.build();
}

/**
 * A rhythm and a lead guitar over three sections of four bars (Intro, Verse, Chorus), the chords
 * Am F C G written above each bar, so the insights have a key, chord names and sections to show.
 */
export const INSIGHTS = {
  file: 'insights.reprise',
  sections: ['Intro', 'Verse', 'Chorus'],
  progression: 'Am–F–C–G',
} as const;

function insightsScore(): Score {
  // Open-position shapes as [string, fret] pairs, string 1 being the high E.
  const shapes: Record<string, [number, number][]> = {
    Am: [
      [5, 0],
      [4, 2],
      [3, 2],
      [2, 1],
      [1, 0],
    ],
    F: [
      [4, 3],
      [3, 2],
      [2, 1],
      [1, 1],
    ],
    C: [
      [5, 3],
      [4, 2],
      [3, 0],
      [2, 1],
      [1, 0],
    ],
    G: [
      [6, 3],
      [5, 2],
      [4, 0],
      [3, 0],
      [2, 0],
      [1, 3],
    ],
  };
  const names = Object.keys(shapes);
  const bars = INSIGHTS.sections.length * 4;
  const builder = score().tempo(100).track('guitar', { name: 'Rhythm' });
  for (let bar = 0; bar < bars; bar += 1) {
    builder.bar();
    if (bar % 4 === 0) builder.section(INSIGHTS.sections[bar / 4] ?? '');
    const name = names[bar % 4] ?? 'Am';
    for (let beat = 0; beat < 4; beat += 1) {
      builder.beat(
        '4',
        (shapes[name] ?? []).map(([string, fret]) => note(string, fret)),
        beat === 0 ? { chord: { name } } : {},
      );
    }
  }
  builder.track('guitar', { name: 'Lead' });
  for (let bar = 0; bar < bars; bar += 1) {
    builder.bar();
    for (const fret of [5, 8, 10, 8, 5, 3, 5, 8]) builder.beat('8', [note(1, fret)]);
  }
  return builder.build();
}

/** The A2 the tuner flow hears: a harmonic tone 12 cents above 110 Hz. */
export const TUNER_TONE = { sampleRate: 48_000, periods: 332, harmonics: 12, cents: 12 } as const;

/**
 * 16-bit mono WAV of `TUNER_TONE`, for Chromium's fake audio device, which loops the file. The
 * length is a whole number of periods of the fundamental (a hair off 12 cents, far below what the
 * tuner resolves), so the loop point is seamless.
 */
export function tunerToneWav(): Uint8Array {
  const { sampleRate, periods, harmonics } = TUNER_TONE;
  const target = 110 * 2 ** (TUNER_TONE.cents / 1200);
  const length = Math.round((periods * sampleRate) / target);
  const hz = (periods * sampleRate) / length;
  const samples = new Int16Array(length);
  let peak = 0;
  const wave = new Float64Array(length);
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (let n = 1; n <= harmonics; n++) v += Math.sin((2 * Math.PI * n * hz * i) / sampleRate) / n;
    wave[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  for (let i = 0; i < length; i++) samples[i] = Math.round(((wave[i] ?? 0) / peak) * 0.5 * 32767);
  const bytes = new Uint8Array(44 + samples.byteLength);
  const view = new DataView(bytes.buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.byteLength, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.byteLength, true);
  for (let i = 0; i < length; i++) view.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return bytes;
}

/** How many titled songs the library flow adds to the committed fixtures to make fifty. */
export const LIBRARY_SONGS = 23;
export const libraryTitle = (n: number) => `Library Song ${String(n).padStart(2, '0')}`;
export const libraryFile = (n: number) => `library-${String(n).padStart(2, '0')}.reprise`;

export async function generateScores(): Promise<Record<string, Uint8Array>> {
  const song = largeScore(2, 16, { structure: true });
  const library: Record<string, Uint8Array> = {};
  for (let n = 1; n <= LIBRARY_SONGS; n += 1) {
    const titled = {
      ...largeScore(2, 4),
      meta: { ...largeScore(2, 4).meta, title: libraryTitle(n) },
    };
    library[libraryFile(n)] = (await write(titled, 'reprise')).bytes;
  }
  return {
    ...library,
    'song.gp': (await write(song, 'gp')).bytes,
    'song.reprise': (await write(song, 'reprise')).bytes,
    'song48.gp': (await write(largeScore(2, 48, { structure: true }), 'gp')).bytes,
    // Every kind of thing the model holds: the Guitar Pro writer drops some of them (WP-061).
    'export-full.reprise': (await write(fullScore(), 'reprise')).bytes,
    [SECTIONS.file]: (await write(sectionsScore(), 'reprise')).bytes,
    [INSIGHTS.file]: (await write(insightsScore(), 'reprise')).bytes,
    'long-score.reprise': (await write(longScore(), 'reprise')).bytes,
    'tuner-a2.wav': tunerToneWav(),
  };
}
