/**
 * Generates the font metrics `@reprise/layout` measures with, so layout never needs a DOM:
 *
 *   packages/layout/src/metrics/bravura.json   SMuFL glyphs in staff spaces (1 em = 4 spaces)
 *   packages/layout/src/metrics/geist.json     UI text advances in font units at weight 400
 *
 * Reads the fonts from apps/web/public/fonts/bravura and @fontsource-variable/geist, and the
 * SMuFL metadata from ./data.
 *
 *   node scripts/layout/metrics.ts           rewrite both files
 *   node scripts/layout/metrics.ts --check   exit 1 if either is out of date
 */
import { readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

import { create, type Font } from 'fontkit';
import { format, resolveConfig } from 'prettier';

export const ROOT_DIR = join(import.meta.dirname, '..', '..');
export const BRAVURA_DIR = join(ROOT_DIR, 'apps', 'web', 'public', 'fonts', 'bravura');
/** SMuFL metadata: build inputs only, so they stay out of the web build. */
export const DATA_DIR = join(import.meta.dirname, 'data');
const GEIST_PACKAGE = join(
  ROOT_DIR,
  'apps',
  'web',
  'node_modules',
  '@fontsource-variable',
  'geist',
);
const METRICS_DIR = join(ROOT_DIR, 'packages', 'layout', 'src', 'metrics');
export const BRAVURA_METRICS = join(METRICS_DIR, 'bravura.json');
export const GEIST_METRICS = join(METRICS_DIR, 'geist.json');

/** The SMuFL glyphs layout draws or measures. Adding one here and rerunning is all it takes. */
export const GLYPHS = [
  'gClef',
  'gClef8vb',
  'gClef8va',
  'gClef15mb',
  'gClef15ma',
  'fClef',
  'fClef8vb',
  'fClef8va',
  'fClef15mb',
  'fClef15ma',
  'cClef',
  'cClef8vb',
  'unpitchedPercussionClef1',
  '6stringTabClef',
  '4stringTabClef',
  'timeSig0',
  'timeSig1',
  'timeSig2',
  'timeSig3',
  'timeSig4',
  'timeSig5',
  'timeSig6',
  'timeSig7',
  'timeSig8',
  'timeSig9',
  'accidentalFlat',
  'accidentalNatural',
  'accidentalSharp',
  'accidentalDoubleSharp',
  'accidentalDoubleFlat',
  'repeatDot',
  'segno',
  'coda',
  'codaSquare',
  'metNoteWhole',
  'metNoteHalfUp',
  'metNoteQuarterUp',
  'metNote8thUp',
  'metAugmentationDot',
  'noteheadBlack',
  'noteheadHalf',
  'noteheadWhole',
  'noteheadXBlack',
  'augmentationDot',
  'restWhole',
  'restHalf',
  'restQuarter',
  'rest8th',
  'rest16th',
  'rest32nd',
  'rest64th',
  'rest128th',
  'rest256th',
  'noteheadXWhole',
  'noteheadXHalf',
  'noteheadDiamondWhole',
  'noteheadDiamondHalf',
  'noteheadDiamondBlack',
  'noteheadTriangleUpWhole',
  'noteheadTriangleUpHalf',
  'noteheadTriangleUpBlack',
  'flag8thUp',
  'flag8thDown',
  'flag16thUp',
  'flag16thDown',
  'flag32ndUp',
  'flag32ndDown',
  'flag64thUp',
  'flag64thDown',
  'flag128thUp',
  'flag128thDown',
  'flag256thUp',
  'flag256thDown',
  'dynamicPP',
  'dynamicPPP',
  'dynamicMP',
  'dynamicMF',
  'dynamicFF',
  'dynamicFFF',
  'accidentalParensLeft',
  'accidentalParensRight',
  'tuplet0',
  'tuplet1',
  'tuplet2',
  'tuplet3',
  'tuplet4',
  'tuplet5',
  'tuplet6',
  'tuplet7',
  'tuplet8',
  'tuplet9',
  'dynamicPiano',
  'dynamicForte',
  'fingering1',
  'fingering2',
  'fingering3',
  'fingering4',
  'fingeringTUpper',
  'fingeringPLower',
  'fingeringILower',
  'fingeringMLower',
  'fingeringALower',
  'fingeringCLower',
  'articStaccatoAbove',
  'articStaccatoBelow',
  'articAccentAbove',
  'articAccentBelow',
  'articMarcatoAbove',
  'articMarcatoBelow',
  'tremolo1',
  'tremolo2',
  'tremolo3',
  'stringsDownBow',
  'stringsUpBow',
  'guitarFadeIn',
  'guitarFadeOut',
  'guitarVolumeSwell',
  'ornamentTrill',
  'noteheadParenthesisLeft',
  'noteheadParenthesisRight',
] as const;

/** Printable ASCII plus what tab and effect labels use beyond it. */
const TEXT_CHARACTERS = [
  ...Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCodePoint(0x20 + i)),
  ...Array.from('½¼¾×–—…•·°'),
];

const round = (value: number): number => Math.round(value * 1000) / 1000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readJson(path: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!isRecord(parsed)) throw new Error(`${path} is not a JSON object`);
  return parsed;
}

function field(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) throw new Error(`missing object "${key}"`);
  return value;
}

function point(value: unknown, what: string): [number, number] {
  if (Array.isArray(value) && value.length === 2) {
    const x: unknown = value[0];
    const y: unknown = value[1];
    if (typeof x === 'number' && typeof y === 'number') return [x, y];
  }
  throw new Error(`${what} is not a point`);
}

function openFont(path: string): Font {
  const font = create(readFileSync(path));
  if (!('glyphForCodePoint' in font)) throw new Error(`${path} is a font collection`);
  return font;
}

function packageVersion(dir: string): string {
  const version = readJson(join(dir, 'package.json'))['version'];
  if (typeof version !== 'string') throw new Error(`${dir} has no version`);
  return version;
}

export function bravuraMetrics(): Record<string, unknown> {
  const metadata = readJson(join(DATA_DIR, 'bravura_metadata.json'));
  const names = readJson(join(DATA_DIR, 'glyphnames.json'));
  const boxes = field(metadata, 'glyphBBoxes');
  const anchors = field(metadata, 'glyphsWithAnchors');
  const font = openFont(join(BRAVURA_DIR, 'Bravura.otf'));
  const spacesPerUnit = 4 / font.unitsPerEm;

  const engravingDefaults = Object.fromEntries(
    Object.entries(field(metadata, 'engravingDefaults')).flatMap(([key, value]) =>
      typeof value === 'number' ? [[key, round(value)]] : [],
    ),
  );

  const glyphs = Object.fromEntries(
    GLYPHS.map((name) => {
      const entry = names[name];
      const codepointText = isRecord(entry) ? entry['codepoint'] : undefined;
      if (typeof codepointText !== 'string') throw new Error(`${name} is not a SMuFL glyph`);
      const codepoint = Number.parseInt(codepointText.slice(2), 16);
      const glyph = font.glyphForCodePoint(codepoint);
      if (glyph.id === 0) throw new Error(`Bravura has no glyph for ${name}`);
      const box = boxes[name];
      if (!isRecord(box)) throw new Error(`Bravura metadata has no bounding box for ${name}`);
      const [left, bottom] = point(box['bBoxSW'], `${name} bBoxSW`);
      const [right, top] = point(box['bBoxNE'], `${name} bBoxNE`);
      const glyphAnchors = anchors[name];
      return [
        name,
        {
          codepoint,
          advance: round(glyph.advanceWidth * spacesPerUnit),
          bbox: { left: round(left), bottom: round(bottom), right: round(right), top: round(top) },
          ...(isRecord(glyphAnchors) && {
            anchors: Object.fromEntries(
              Object.entries(glyphAnchors).map(([key, value]) => [
                key,
                point(value, `${name} ${key}`).map(round),
              ]),
            ),
          }),
        },
      ];
    }),
  );

  return {
    font: { family: 'Bravura', version: metadata['fontVersion'], unitsPerSpace: 'staff spaces' },
    engravingDefaults,
    glyphs,
  };
}

export function geistMetrics(): Record<string, unknown> {
  const font = openFont(join(GEIST_PACKAGE, 'files', 'geist-latin-wght-normal.woff2'));
  const advances: Record<string, number> = {};
  for (const character of TEXT_CHARACTERS) {
    const codepoint = character.codePointAt(0) ?? 0;
    const glyph = font.glyphForCodePoint(codepoint);
    if (glyph.id === 0) throw new Error(`Geist has no glyph for U+${codepoint.toString(16)}`);
    advances[character] = glyph.advanceWidth;
  }
  return {
    font: {
      family: 'Geist Variable',
      package: `@fontsource-variable/geist@${packageVersion(GEIST_PACKAGE)}`,
      weight: 400,
      unitsPerEm: font.unitsPerEm,
      ascent: font.ascent,
      descent: font.descent,
      capHeight: font.capHeight,
      xHeight: font.xHeight,
    },
    advances,
  };
}

export async function render(path: string, value: unknown): Promise<string> {
  const options = await resolveConfig(path);
  return format(JSON.stringify(value), { ...options, filepath: path });
}

export async function generate(): Promise<{ path: string; text: string }[]> {
  return [
    { path: BRAVURA_METRICS, text: await render(BRAVURA_METRICS, bravuraMetrics()) },
    { path: GEIST_METRICS, text: await render(GEIST_METRICS, geistMetrics()) },
  ];
}

async function main(): Promise<void> {
  const outputs = await generate();
  if (argv.includes('--check')) {
    let stale = false;
    for (const { path, text } of outputs) {
      const current = await readFile(path, 'utf8').catch(() => '');
      if (current !== text) {
        console.error(`${path} is out of date; run \`pnpm layout:metrics\`.`);
        stale = true;
      }
    }
    if (stale) exit(1);
    console.log('Layout font metrics are up to date.');
    return;
  }
  for (const { path, text } of outputs) await writeFile(path, text);
  console.log(`Wrote ${outputs.map(({ path }) => path.slice(ROOT_DIR.length + 1)).join(', ')}.`);
}

if (import.meta.main) await main();
