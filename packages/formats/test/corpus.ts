import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Score } from '@reprise/model';

export const FIXTURES_DIR = join(import.meta.dirname, '..', '..', '..', 'fixtures');

export interface ManifestEntry {
  path: string;
  format: string;
  features: string[];
  tracks: number;
  bars: number;
  notes: number;
}

function isManifest(value: unknown): value is { fixtures: ManifestEntry[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixtures' in value &&
    Array.isArray(value.fixtures)
  );
}

/** Every fixture in `fixtures/manifest.json`, whatever its format. */
export function allManifestEntries(): ManifestEntry[] {
  const manifest: unknown = JSON.parse(readFileSync(join(FIXTURES_DIR, 'manifest.json'), 'utf8'));
  if (!isManifest(manifest)) throw new Error('fixtures/manifest.json has no fixtures list');
  return manifest.fixtures;
}

export function manifestEntries(formats: readonly string[]): ManifestEntry[] {
  return allManifestEntries().filter((entry) => formats.includes(entry.format));
}

export function fixtureBytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(FIXTURES_DIR, path)));
}

/** Notes as the manifest counts them: alphaTab keeps grace notes as beats of their own. */
export function countNotes(score: Score): number {
  let notes = 0;
  for (const track of score.tracks) {
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          notes += beat.notes.length;
          for (const grace of beat.grace ?? []) notes += grace.notes.length;
        }
      }
    }
  }
  return notes;
}

/** The manifest's feature vocabulary, read off our model the way the describe script reads alphaTab's. */
export function featuresOf(score: Score): Set<string> {
  const found = new Set<string>();
  const tempos = new Set<number>();
  score.masterBars.forEach((masterBar, i) => {
    if (masterBar.repeat.start || masterBar.repeat.endCount > 0) found.add('repeats');
    if (masterBar.alternateEndings.length > 0) found.add('alternate-endings');
    if (masterBar.jumps.length > 0 || masterBar.targets.length > 0) found.add('jumps');
    if (masterBar.tempo) tempos.add(masterBar.tempo.bpm);
    const previous = score.masterBars[i - 1];
    if (!previous) return;
    const [a, b] = [previous.timeSignature, masterBar.timeSignature];
    if (a.numerator !== b.numerator || a.denominator !== b.denominator) {
      found.add('time-signature-change');
    }
    const [k, l] = [previous.keySignature, masterBar.keySignature];
    if (k.fifths !== l.fifths || k.minor !== l.minor) found.add('key-change');
  });
  if (score.tracks.length > 1) found.add('multiple-tracks');
  for (const track of score.tracks) {
    if (track.kind === 'drums') found.add('drums-track');
    if (track.kind === 'pitched') found.add('pitched-non-fretted-track');
    for (const bar of track.bars) {
      bar.voices.forEach((voice, v) => {
        for (const beat of voice.beats) {
          if (v > 0 && beat.notes.length > 0) found.add('multiple-voices');
          if (beat.tuplet) found.add('tuplets');
          if (beat.lyrics?.some((line) => line.trim() !== '') === true) found.add('lyrics');
          if (beat.mix?.tempo) tempos.add(beat.mix.tempo.bpm);
          if (beat.chord?.diagram?.frets.some((fret) => fret !== null) === true) {
            found.add('chord-diagrams');
          }
          for (const note of beat.notes) {
            if (note.bend) found.add('bends');
            if (note.slide) found.add('slides');
            if (note.hammerPull) found.add('hammer-ons');
            if (note.harmonic) found.add('harmonics');
            if (note.palmMute) found.add('palm-mute');
          }
        }
      });
    }
  }
  if (tempos.size > 1) found.add('tempo-change');
  return found;
}
