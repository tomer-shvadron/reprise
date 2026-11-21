/**
 * Glyph and text shapes for the SVG writer, from the tables `scripts/layout/metrics.ts` generates
 * (`outlines/*.json`): path data in font units, y up, origin on the baseline. The tables load on
 * demand so the main chunk does not carry them.
 *
 * Bravura and Geist are SIL OFL 1.1, which allows their outlines in documents; see the score README.
 */
import { z } from 'zod';

const glyphTable = z.record(z.string(), z.object({ d: z.string(), advance: z.number() }));

const bravuraFile = z.object({ unitsPerEm: z.number(), glyphs: glyphTable });
const geistFile = z.object({
  unitsPerEm: z.number(),
  '400': glyphTable,
  '400i': glyphTable,
  '600': glyphTable,
});

export type GlyphTable = z.infer<typeof glyphTable>;
export type OutlineGlyph = GlyphTable[string];

/** `400i` is regular italic. */
export type GeistStyle = '400' | '400i' | '600';

export interface Outlines {
  bravura: { unitsPerEm: number; glyphs: GlyphTable };
  geist: { unitsPerEm: number; styles: Readonly<Record<GeistStyle, GlyphTable>> };
}

/** The tables as the generator wrote them; the schemas make a stale or hand-edited file fail loudly. */
export function parseOutlines(bravuraJson: unknown, geistJson: unknown): Outlines {
  const bravura = bravuraFile.parse(bravuraJson);
  const geist = geistFile.parse(geistJson);
  return {
    bravura: { unitsPerEm: bravura.unitsPerEm, glyphs: bravura.glyphs },
    geist: {
      unitsPerEm: geist.unitsPerEm,
      styles: { '400': geist['400'], '400i': geist['400i'], '600': geist['600'] },
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
 * layout measured and what `.score-text` draws.
 */
export function textRun(text: string, table: GlyphTable): TextRun {
  const chars: TextRun['chars'] = [];
  let x = 0;
  let missing = false;
  for (const character of text) {
    const codepoint = character.codePointAt(0) ?? 0;
    const glyph = table[String(codepoint)];
    if (!glyph) {
      missing = true;
      continue;
    }
    chars.push({ codepoint, x });
    x += glyph.advance;
  }
  return { chars, width: x, missing };
}
