/**
 * Regenerates `fixtures/manifest.json` by parsing every fixture with alphaTab, the oracle our
 * own readers are checked against. Features are read off the parsed model, never declared by
 * hand, so the manifest only claims what the oracle actually sees.
 *
 *   node scripts/fixtures/describe.ts           rewrite the manifest
 *   node scripts/fixtures/describe.ts --check   exit 1 if the manifest is out of date
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

import * as alphaTab from '@coderline/alphatab';
import { format, resolveConfig } from 'prettier';

import {
  FEATURES,
  FIXTURES_DIR,
  FORMATS,
  MANIFEST_PATH,
  isFixtureName,
  type Feature,
  type FixtureEntry,
  type Format,
  type Manifest,
} from './corpus.ts';

const { AutomationType, BendType, HarmonicType, SlideInType, SlideOutType } = alphaTab.model;

type Score = alphaTab.model.Score;

function settings(): alphaTab.Settings {
  const result = new alphaTab.Settings();
  result.core.logLevel = alphaTab.LogLevel.None;
  return result;
}

/** General MIDI programs of fretted instruments: guitars and basses, then sitar to koto. */
const FRETTED_PROGRAMS = new Set([
  ...Array.from({ length: 16 }, (_, i) => 24 + i),
  104,
  105,
  106,
  107,
]);

/**
 * alphaTab gives a piano track a default six-string tuning, so the string count cannot tell a
 * keyboard from a guitar; the instrument and the absence of tablature together can. gp3 and gp4
 * store no staff flags and get tablature by default, so this never fires for them.
 */
function isPitchedNonFretted(track: alphaTab.model.Track): boolean {
  return (
    !FRETTED_PROGRAMS.has(track.playbackInfo.program) &&
    track.staves.every((staff) => !staff.isPercussion && !staff.showTablature)
  );
}

export function describeScore(score: Score): Omit<FixtureEntry, 'path' | 'format'> {
  const found = new Set<Feature>();
  let notes = 0;

  const tempos = new Set<number>([score.tempo]);
  for (const masterBar of score.masterBars) {
    if (masterBar.isRepeatStart || masterBar.repeatCount > 0) found.add('repeats');
    if (masterBar.alternateEndings !== 0) found.add('alternate-endings');
    if (masterBar.directions !== null && masterBar.directions.size > 0) found.add('jumps');
    for (const automation of masterBar.tempoAutomations) tempos.add(automation.value);

    const previous = masterBar.previousMasterBar;
    if (
      previous !== null &&
      (previous.timeSignatureNumerator !== masterBar.timeSignatureNumerator ||
        previous.timeSignatureDenominator !== masterBar.timeSignatureDenominator)
    ) {
      found.add('time-signature-change');
    }
  }

  if (score.tracks.length > 1) found.add('multiple-tracks');
  for (const track of score.tracks) {
    if (isPitchedNonFretted(track)) found.add('pitched-non-fretted-track');
    for (const staff of track.staves) {
      if (staff.isPercussion) found.add('drums-track');

      for (const bar of staff.bars) {
        const previous = bar.previousBar;
        if (
          previous !== null &&
          (previous.keySignature !== bar.keySignature ||
            previous.keySignatureType !== bar.keySignatureType)
        ) {
          found.add('key-change');
        }

        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            notes += beat.notes.length;
            if (voice.index > 0 && beat.notes.length > 0) found.add('multiple-voices');
            if (beat.tupletNumerator > 1 && beat.tupletNumerator !== beat.tupletDenominator) {
              found.add('tuplets');
            }
            if (beat.lyrics?.some((line) => line.trim() !== '') === true) found.add('lyrics');
            for (const automation of beat.automations) {
              if (automation.type === AutomationType.Tempo) tempos.add(automation.value);
            }
            if (beat.chordId !== null) {
              const chord = staff.chords?.get(beat.chordId);
              if (chord?.strings.some((fret) => fret >= 0) === true) found.add('chord-diagrams');
            }

            for (const note of beat.notes) {
              if (note.bendType !== BendType.None) found.add('bends');
              if (
                note.slideInType !== SlideInType.None ||
                note.slideOutType !== SlideOutType.None
              ) {
                found.add('slides');
              }
              if (note.isHammerPullOrigin) found.add('hammer-ons');
              if (note.harmonicType !== HarmonicType.None) found.add('harmonics');
              if (note.isPalmMute) found.add('palm-mute');
            }
          }
        }
      }
    }
  }

  if (tempos.size > 1) found.add('tempo-change');

  return {
    features: FEATURES.filter((feature) => found.has(feature)),
    tracks: score.tracks.length,
    bars: score.masterBars.length,
    notes,
  };
}

export function describeBytes(bytes: Uint8Array): Omit<FixtureEntry, 'path' | 'format'> {
  return describeScore(alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings()));
}

async function describeFormat(fixtureFormat: Format): Promise<FixtureEntry[]> {
  const names = (await readdir(join(FIXTURES_DIR, fixtureFormat))).filter(isFixtureName).sort();
  const entries: FixtureEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(`.${fixtureFormat}`)) {
      throw new Error(
        `fixtures/${fixtureFormat}/${name} does not have the .${fixtureFormat} extension`,
      );
    }
    const bytes = new Uint8Array(await readFile(join(FIXTURES_DIR, fixtureFormat, name)));
    entries.push({
      path: `${fixtureFormat}/${name}`,
      format: fixtureFormat,
      ...describeBytes(bytes),
    });
  }
  return entries;
}

async function oracleVersion(): Promise<string> {
  const packageJson: unknown = JSON.parse(
    await readFile(
      join(
        import.meta.dirname,
        '..',
        '..',
        'node_modules',
        '@coderline',
        'alphatab',
        'package.json',
      ),
      'utf8',
    ),
  );
  if (
    typeof packageJson === 'object' &&
    packageJson !== null &&
    'version' in packageJson &&
    typeof packageJson.version === 'string'
  ) {
    return packageJson.version;
  }
  throw new Error('could not read the installed @coderline/alphatab version');
}

async function render(manifest: Manifest): Promise<string> {
  const options = await resolveConfig(MANIFEST_PATH);
  return format(JSON.stringify(manifest), { ...options, filepath: MANIFEST_PATH });
}

async function main(): Promise<void> {
  const fixtures: FixtureEntry[] = [];
  for (const fixtureFormat of FORMATS) fixtures.push(...(await describeFormat(fixtureFormat)));

  const manifest: Manifest = {
    oracle: { name: '@coderline/alphatab', version: await oracleVersion() },
    features: [...FEATURES],
    fixtures,
  };
  const text = await render(manifest);

  if (argv.includes('--check')) {
    const current = await readFile(MANIFEST_PATH, 'utf8').catch(() => '');
    if (current !== text) {
      console.error('fixtures/manifest.json is out of date; run `pnpm fixtures:describe`.');
      exit(1);
    }
    console.log(`fixtures/manifest.json is up to date (${String(fixtures.length)} fixtures).`);
    return;
  }

  await writeFile(MANIFEST_PATH, text);
  console.log(`Wrote fixtures/manifest.json (${String(fixtures.length)} fixtures).`);
}

if (import.meta.main) await main();
