/**
 * The shape of the fixture corpus, shared by the describe script and the manifest test. It
 * imports nothing from alphaTab, so the test can use it without loading the oracle.
 */
import { join } from 'node:path';

export const ROOT_DIR = join(import.meta.dirname, '..', '..');
export const FIXTURES_DIR = join(ROOT_DIR, 'fixtures');
export const MANIFEST_PATH = join(FIXTURES_DIR, 'manifest.json');

/** Each format's fixtures live in `fixtures/<format>/` and carry that extension. */
export const FORMATS = ['gp3', 'gp4', 'gp5', 'gpx', 'gp'] as const;
export type Format = (typeof FORMATS)[number];

export const FEATURES = [
  'repeats',
  'alternate-endings',
  'jumps',
  'tuplets',
  'bends',
  'slides',
  'hammer-ons',
  'harmonics',
  'palm-mute',
  'drums-track',
  'pitched-non-fretted-track',
  'time-signature-change',
  'key-change',
  'tempo-change',
  'lyrics',
  'chord-diagrams',
  'multiple-voices',
] as const;
export type Feature = (typeof FEATURES)[number];

export interface FixtureEntry {
  path: string;
  format: Format;
  features: Feature[];
  tracks: number;
  bars: number;
  notes: number;
}

export interface Manifest {
  oracle: { name: string; version: string };
  features: Feature[];
  fixtures: FixtureEntry[];
}

/** Files in `fixtures/` that are documentation rather than fixtures. */
export const NON_FIXTURE_FILES = new Set(['LICENSES.md', 'MPL-2.0.txt', 'manifest.json']);

/** Finder's `.DS_Store` and other dotfiles are never fixtures. */
export const isFixtureName = (name: string): boolean => !name.startsWith('.');
