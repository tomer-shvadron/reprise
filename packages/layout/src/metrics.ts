import bravura from './metrics/bravura.json' with { type: 'json' };
import geist from './metrics/geist.json' with { type: 'json' };

/** Every SMuFL glyph the metrics table holds; `scripts/layout/metrics.ts` decides the list. */
export type GlyphName = keyof typeof bravura.glyphs;

/** Glyph metrics in staff spaces, y up, as SMuFL defines them. */
export interface GlyphMetrics {
  codepoint: number;
  advance: number;
  bbox: { left: number; bottom: number; right: number; top: number };
}

export function glyphMetrics(name: GlyphName): GlyphMetrics {
  return bravura.glyphs[name];
}

/** A SMuFL anchor of the glyph (`stemUpSE`, `stemDownNW`, ...), in staff spaces, y up. */
export function glyphAnchor(
  name: GlyphName,
  anchor: string,
): readonly [number, number] | undefined {
  const entry = bravura.glyphs[name];
  const anchors: Partial<Record<string, readonly number[]>> =
    'anchors' in entry ? entry.anchors : {};
  const point = anchors[anchor];
  const [x, y] = point ?? [];
  return x === undefined || y === undefined ? undefined : [x, y];
}

/** Bravura's engraving defaults, in staff spaces. */
export const engraving = bravura.engravingDefaults;

const advances: Partial<Record<string, number>> = geist.advances;
const unitsPerEm = geist.font.unitsPerEm;
const fallbackAdvance = geist.advances['0'];

/** Width in px of `text` in the UI font at `size` px, without kerning. */
export function textWidth(text: string, size: number): number {
  let units = 0;
  for (const character of text) units += advances[character] ?? fallbackAdvance;
  return (units * size) / unitsPerEm;
}

/** Height above and depth below the baseline, in px, of the UI font's capitals at `size` px. */
export function textExtent(size: number): { ascent: number; descent: number } {
  return {
    ascent: (geist.font.capHeight * size) / unitsPerEm,
    descent: (-geist.font.descent * size) / unitsPerEm,
  };
}
