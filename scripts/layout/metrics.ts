/**
 * Generates the font metrics `@reprise/layout` measures with, so layout never needs a DOM:
 *
 *   packages/layout/src/metrics/bravura.json   SMuFL glyphs in staff spaces (1 em = 4 spaces)
 *   packages/layout/src/metrics/geist.json     UI text advances in font units at weight 400
 *
 * Reads the fonts from apps/web/public/fonts/bravura and @fontsource-variable/geist, and the
 * SMuFL metadata from ./data.
 *
 * It also writes the outline tables the SVG image export draws text and glyphs from, so the SVG
 * needs no font installed:
 *
 *   apps/web/src/features/score/image/outlines/bravura.json   the GLYPHS above as SVG path data
 *   apps/web/src/features/score/image/outlines/geist.json     Latin and Latin Extended, 400, 400 italic and 600
 *
 * Both fonts are SIL OFL 1.1, which allows their outlines in documents (see the score README).
 *
 *   node scripts/layout/metrics.ts           rewrite every file
 *   node scripts/layout/metrics.ts --check   exit 1 if any is out of date
 */
import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
const OUTLINES_DIR = join(ROOT_DIR, 'apps', 'web', 'src', 'features', 'score', 'image', 'outlines');
export const BRAVURA_OUTLINES = join(OUTLINES_DIR, 'bravura.json');
export const GEIST_OUTLINES = join(OUTLINES_DIR, 'geist.json');
/** Static Geist faces: the variable files cannot be instanced at weight 600 through fontkit's WOFF2 reader. */
const GEIST_STATIC = join(ROOT_DIR, 'apps', 'web', 'node_modules', '@fontsource', 'geist');

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
  'guitarGolpe',
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

/** An outline table: font units, y up, origin on the baseline. */
export interface OutlineGlyph {
  /** Path data, integer coordinates, relative commands. Empty for a blank glyph such as a space. */
  d: string;
  advance: number;
}

/**
 * Path data in font units with integer coordinates. Relative commands keep the numbers short, and
 * each is taken between the rounded absolute points, so rounding never drifts along a contour.
 */
export function outlinePath(commands: readonly { command: string; args: number[] }[]): string {
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;
  let out = '';
  const rel = (x: number, y: number): string => {
    const dx = Math.round(x) - cx;
    const dy = Math.round(y) - cy;
    return `${String(dx)} ${String(dy)}`;
  };
  const numbers = (text: string) => text.replaceAll(' -', '-');
  for (const { command, args } of commands) {
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
    switch (command) {
      case 'moveTo':
        out += `m${numbers(rel(a, b))}`;
        cx = startX = Math.round(a);
        cy = startY = Math.round(b);
        break;
      case 'lineTo':
        out += `l${numbers(rel(a, b))}`;
        cx = Math.round(a);
        cy = Math.round(b);
        break;
      case 'quadraticCurveTo':
        out += `q${numbers(`${rel(a, b)} ${rel(c, d)}`)}`;
        cx = Math.round(c);
        cy = Math.round(d);
        break;
      case 'bezierCurveTo':
        out += `c${numbers(`${rel(a, b)} ${rel(c, d)} ${rel(e, f)}`)}`;
        cx = Math.round(e);
        cy = Math.round(f);
        break;
      case 'closePath':
        out += 'z';
        // A closed subpath leaves the current point at its start.
        cx = startX;
        cy = startY;
        break;
    }
  }
  return out;
}

function outlineOf(glyph: ReturnType<Font['glyphForCodePoint']>, dy = 0): OutlineGlyph {
  const commands = glyph.path.commands.map(({ command, args }) => ({
    command,
    args: args.map((value, i) => (i % 2 === 1 ? value + dy : value)),
  }));
  return { d: outlinePath(commands), advance: Math.round(glyph.advanceWidth) };
}

/** One glyph per line, so a regenerated table diffs by glyph. */
function outlineText(
  header: Record<string, unknown>,
  groups: Record<string, Record<string, OutlineGlyph>>,
): string {
  const lines = Object.entries(groups).map(([group, glyphs]) => {
    const rows = Object.entries(glyphs).map(
      ([key, glyph]) => `${JSON.stringify(key)}:${JSON.stringify(glyph)}`,
    );
    return `${JSON.stringify(group)}:{\n${rows.join(',\n')}\n}`;
  });
  return `{\n${JSON.stringify(header).slice(1, -1)},\n${lines.join(',\n')}\n}\n`;
}

export function bravuraOutlines(): string {
  const metadata = readJson(join(DATA_DIR, 'bravura_metadata.json'));
  const names = readJson(join(DATA_DIR, 'glyphnames.json'));
  const font = openFont(join(BRAVURA_DIR, 'Bravura.otf'));
  const glyphs: Record<string, OutlineGlyph> = {};
  for (const name of GLYPHS) {
    const entry = names[name];
    const codepointText = isRecord(entry) ? entry['codepoint'] : undefined;
    if (typeof codepointText !== 'string') throw new Error(`${name} is not a SMuFL glyph`);
    const codepoint = Number.parseInt(codepointText.slice(2), 16);
    glyphs[String(codepoint)] = outlineOf(font.glyphForCodePoint(codepoint));
  }
  const sorted = Object.fromEntries(
    Object.entries(glyphs).sort(([a], [b]) => Number(a) - Number(b)),
  );
  return outlineText(
    {
      ...NOTICES.bravura,
      font: 'Bravura',
      version: metadata['fontVersion'],
      unitsPerEm: font.unitsPerEm,
    },
    { glyphs: sorted },
  );
}

/**
 * The faces the export draws text in. Italic is the painter's synthetic oblique of the upright
 * face (a skew in the SVG), so there is no italic table.
 */
const GEIST_STYLES = [
  { key: '400', file: '400-normal' },
  { key: '600', file: '600-normal' },
] as const;

/** Geist has no sharp, flat or natural sign; the chord names `F♯m7` take them from Bravura. */
const ACCIDENTAL_SIGNS = [0x266f, 0x266d, 0x266e] as const;

/** Pairs of printable ASCII: what a title or byline kerns, which print does and layout does not. */
const KERN_CHARACTERS = Array.from({ length: 0x7f - 0x20 }, (_, i) =>
  String.fromCodePoint(0x20 + i),
);

function kerning(font: Font): Record<string, number> {
  const pairs: Record<string, number> = {};
  for (const left of KERN_CHARACTERS) {
    for (const right of KERN_CHARACTERS) {
      const run = font.layout(left + right, ['kern']);
      // A ligature (ff, fi) is one glyph, not a kern pair; the export draws characters one by one.
      if (run.glyphs.length !== 2) continue;
      const [first] = run.positions;
      const natural = font.glyphForCodePoint(left.codePointAt(0) ?? 0).advanceWidth;
      const delta = Math.round((first?.xAdvance ?? natural) - natural);
      if (delta !== 0) pairs[left + right] = delta;
    }
  }
  return pairs;
}

const NOTICES = {
  bravura: {
    copyright: 'Copyright (c) 2015, Steinberg Media Technologies GmbH (http://www.steinberg.net/)',
    license: 'SIL Open Font License 1.1 (OFL-1.1), see apps/web/public/fonts/bravura/OFL.txt',
    note: 'Outlines of the Bravura glyphs the score draws, converted to SVG path data. The Reserved Font Name "Bravura" belongs to the font; this table is data for drawing, not a font.',
  },
  geist: {
    copyright: 'Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)',
    license: 'SIL Open Font License 1.1 (OFL-1.1), see node_modules/@fontsource/geist/LICENSE',
    note: 'Outlines of Latin and Latin Extended Geist, converted to SVG path data, with the sharp, flat and natural signs from Bravura (OFL-1.1, Copyright (c) 2015, Steinberg Media Technologies GmbH). This table is data for drawing, not a font.',
  },
} as const;

export function geistOutlines(): string {
  const groups: Record<string, Record<string, OutlineGlyph>> = {};
  const kern: Record<string, Record<string, number>> = {};
  const bravura = openFont(join(BRAVURA_DIR, 'Bravura.otf'));
  let unitsPerEm = 0;
  let ascent = 0;
  let descent = 0;
  for (const { key, file } of GEIST_STYLES) {
    const glyphs = new Map<number, OutlineGlyph>();
    for (const subset of ['latin', 'latin-ext']) {
      const font = openFont(join(GEIST_STATIC, 'files', `geist-${subset}-${file}.woff2`));
      if (subset === 'latin') {
        unitsPerEm = font.unitsPerEm;
        ascent = font.ascent;
        descent = -font.descent;
        kern[key] = kerning(font);
      }
      for (const codepoint of font.characterSet) {
        // Controls have no shape and no business in a score's text.
        if (codepoint < 0x20 || (codepoint >= 0x7f && codepoint < 0xa0)) continue;
        if (glyphs.has(codepoint)) continue;
        glyphs.set(codepoint, outlineOf(font.glyphForCodePoint(codepoint)));
      }
    }
    for (const codepoint of ACCIDENTAL_SIGNS) {
      if (glyphs.has(codepoint)) continue;
      const glyph = bravura.glyphForCodePoint(codepoint);
      if (glyph.id === 0) throw new Error(`Bravura has no glyph for U+${codepoint.toString(16)}`);
      // Bravura centres a sign on the staff line; text sets it on the baseline.
      glyphs.set(codepoint, outlineOf(glyph, -glyph.bbox.minY));
    }
    groups[key] = Object.fromEntries(
      [...glyphs].sort(([a], [b]) => a - b).map(([codepoint, glyph]) => [String(codepoint), glyph]),
    );
  }
  return outlineText(
    {
      ...NOTICES.geist,
      font: 'Geist',
      package: `@fontsource/geist@${packageVersion(GEIST_STATIC)}`,
      unitsPerEm,
      ascent,
      descent,
      kern,
    },
    groups,
  );
}

export async function render(path: string, value: unknown): Promise<string> {
  const options = await resolveConfig(path);
  return format(JSON.stringify(value), { ...options, filepath: path });
}

export async function generate(): Promise<{ path: string; text: string }[]> {
  return [
    { path: BRAVURA_METRICS, text: await render(BRAVURA_METRICS, bravuraMetrics()) },
    { path: GEIST_METRICS, text: await render(GEIST_METRICS, geistMetrics()) },
    { path: BRAVURA_OUTLINES, text: bravuraOutlines() },
    { path: GEIST_OUTLINES, text: geistOutlines() },
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
  for (const { path, text } of outputs) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  }
  console.log(`Wrote ${outputs.map(({ path }) => path.slice(ROOT_DIR.length + 1)).join(', ')}.`);
}

if (import.meta.main) await main();
