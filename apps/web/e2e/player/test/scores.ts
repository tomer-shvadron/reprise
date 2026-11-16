/**
 * The scores the flows open: generated at global setup into `.generated/` (never committed), and
 * the committed fixtures, one per format. The song's facts were read off the app's readout.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { write } from '@reprise/formats';
import type { Notation, Score } from '@reprise/model';
import { fullScore, largeScore } from '@reprise/model/testing';

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
    'long-score.reprise': (await write(longScore(), 'reprise')).bytes,
  };
}
