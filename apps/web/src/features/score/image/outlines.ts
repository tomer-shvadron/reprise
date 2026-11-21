/**
 * Glyph and text shapes for the SVG writer, from the tables `scripts/layout/metrics.ts` generates
 * (`outlines/*.json`): path data in font units, y up, origin on the baseline. The tables load on
 * demand so the main chunk does not carry them.
 *
 * Bravura and Geist are SIL OFL 1.1, which allows their outlines in documents; see the score README.
 */
import { z } from 'zod';

const glyphTable = z.record(z.string(), z.object({ d: z.string(), advance: z.number() }));

const kernTable = z.record(z.string(), z.number());

const bravuraFile = z.object({ unitsPerEm: z.number(), glyphs: glyphTable });
const geistFile = z.object({
  unitsPerEm: z.number(),
  ascent: z.number(),
  descent: z.number(),
  kern: z.object({ '400': kernTable, '600': kernTable }),
  '400': glyphTable,
  '600': glyphTable,
});

export type GlyphTable = z.infer<typeof glyphTable>;
export type OutlineGlyph = GlyphTable[string];

/**
 * The weights outlined. Italic is the painter's synthetic oblique of the upright face, so it is
 * the same outlines with a skew (`ITALIC_SKEW`), not a table of its own.
 */
export type GeistStyle = '400' | '600';

/** Chromium's synthetic oblique (Skia's fake italic): measured as 0.25 of the glyph's height. */
export const ITALIC_SKEW = 0.25;

export interface Outlines {
  bravura: { unitsPerEm: number; glyphs: GlyphTable };
  geist: {
    unitsPerEm: number;
    /** The content area a CSS line box centres text on, in font units. */
    ascent: number;
    descent: number;
    styles: Readonly<Record<GeistStyle, GlyphTable>>;
    /** Pair adjustments in font units, for printable ASCII; what a browser's `font-kerning: auto` applies. */
    kern: Readonly<Record<GeistStyle, Readonly<Record<string, number>>>>;
  };
}

/** The tables as the generator wrote them; the schemas make a stale or hand-edited file fail loudly. */
export function parseOutlines(bravuraJson: unknown, geistJson: unknown): Outlines {
  const bravura = bravuraFile.parse(bravuraJson);
  const geist = geistFile.parse(geistJson);
  return {
    bravura: { unitsPerEm: bravura.unitsPerEm, glyphs: bravura.glyphs },
    geist: {
      unitsPerEm: geist.unitsPerEm,
      ascent: geist.ascent,
      descent: geist.descent,
      styles: { '400': geist['400'], '600': geist['600'] },
      kern: geist.kern,
    },
  };
}

let loading: Promise<Outlines> | undefined;

/** Imports both tables once. */
export function loadOutlines(): Promise<Outlines> {
  loading ??= Promise.all([
    import('./outlines/bravura.json'),
    import('./outlines/geist.json'),
  ]).then(([bravura, geist]) => parseOutlines(bravura.default, geist.default));
  return loading;
}

export interface TextRun {
  /** Each character's code point and its pen position in font units, no kerning (as layout measured). */
  chars: { codepoint: number; x: number }[];
  /** The advance sum in font units. */
  width: number;
  /** True when a character has no outline: the whole string then goes out as `<text>`. */
  missing: boolean;
}

/**
 * Pen positions for a string. Positions are the sum of advances with no kerning, which is what
 * layout measured and what `.score-text` draws; the print heading passes `kern` because print
 * leaves `font-kerning` at auto there.
 */
export function textRun(
  text: string,
  table: GlyphTable,
  kern?: Readonly<Record<string, number>>,
): TextRun {
  const chars: TextRun['chars'] = [];
  let x = 0;
  let missing = false;
  let previous = '';
  for (const character of text) {
    const codepoint = character.codePointAt(0) ?? 0;
    const glyph = table[String(codepoint)];
    if (!glyph) {
      missing = true;
      previous = '';
      continue;
    }
    x += kern?.[previous + character] ?? 0;
    chars.push({ codepoint, x });
    x += glyph.advance;
    previous = character;
  }
  return { chars, width: x, missing };
}
