import type { Id } from '@reprise/model';

import { engraving, glyphAnchor, glyphMetrics, type GlyphName } from '../../../metrics';
import { glyph, line, type LayoutSink } from '../../../primitives';

export type StemDirection = 'up' | 'down';

/** A stem's length from the note nearest its tip, in staff spaces, before beams lengthen it. */
export const STEM_LENGTH = 3.5;
/** Each beam or flag past the second lengthens the stem by this much, in staff spaces. */
const EXTRA_BEAM_LENGTH = 0.75;

/** The stem length, in staff spaces, that leaves room for `beams` flags or beams. */
export function stemLength(beams: number): number {
  return STEM_LENGTH + Math.max(0, beams - 2) * EXTRA_BEAM_LENGTH;
}

export function stemThickness(space: number, scale = 1): number {
  return engraving.stemThickness * space * scale;
}

/**
 * Where an unbeamed stem ends: `stemLength` past `head`, the y of the note nearest the tip, and
 * at least as far as `middle` (the staff's middle line) when given, so a stem on a note far off
 * the staff reaches back into it.
 */
export function stemTip(
  head: number,
  direction: StemDirection,
  beams: number,
  space: number,
  options: { scale?: number; middle?: number } = {},
): number {
  const length = stemLength(beams) * space * (options.scale ?? 1);
  const { middle } = options;
  if (direction === 'up') {
    const tip = head - length;
    return middle === undefined ? tip : Math.min(tip, middle);
  }
  const tip = head + length;
  return middle === undefined ? tip : Math.max(tip, middle);
}

export function drawStem(
  sink: LayoutSink,
  x: number,
  from: number,
  to: number,
  space: number,
  scale: number,
  node: Id,
): void {
  sink.primitives.push(line(x, from, x, to, stemThickness(space, scale), { node }));
}

const FLAGS: readonly (readonly [GlyphName, GlyphName])[] = [
  ['flag8thUp', 'flag8thDown'],
  ['flag16thUp', 'flag16thDown'],
  ['flag32ndUp', 'flag32ndDown'],
  ['flag64thUp', 'flag64thDown'],
  ['flag128thUp', 'flag128thDown'],
  ['flag256thUp', 'flag256thDown'],
];

export function flagGlyph(beams: number, direction: StemDirection): GlyphName | undefined {
  const pair = FLAGS[Math.min(beams, FLAGS.length) - 1];
  if (!pair) return undefined;
  return direction === 'up' ? pair[0] : pair[1];
}

/** The y of a flag's origin on a stem ending at `tip`: its SMuFL stem anchor meets the tip. */
function flagOrigin(name: GlyphName, direction: StemDirection, tip: number, unit: number): number {
  const anchor = glyphAnchor(name, direction === 'up' ? 'stemUpNW' : 'stemDownSW');
  return tip + (anchor?.[1] ?? 0) * unit;
}

/** The y where a flag hanging from a stem ending at `tip` stops short of the head: its box's near edge. */
export function flagReach(
  beams: number,
  direction: StemDirection,
  tip: number,
  space: number,
  scale = 1,
): number | undefined {
  const name = flagGlyph(beams, direction);
  if (!name) return undefined;
  const unit = space * scale;
  const { top, bottom } = glyphMetrics(name).bbox;
  return flagOrigin(name, direction, tip, unit) - (direction === 'up' ? bottom : top) * unit;
}

/** How far an unbeamed stem ending at `tip` reaches: to its flag's far edge, when it has one. */
export function stemEnd(
  tip: number,
  beams: number,
  direction: StemDirection,
  space: number,
  scale = 1,
): number {
  const name = flagGlyph(beams, direction);
  if (!name) return tip;
  const unit = space * scale;
  const origin = flagOrigin(name, direction, tip, unit);
  const { top, bottom } = glyphMetrics(name).bbox;
  return direction === 'up'
    ? Math.min(tip, origin - top * unit)
    : Math.max(tip, origin - bottom * unit);
}

/**
 * The flag on an unbeamed stem whose centre line is `x` and tip `tip`; with `slash`, the
 * acciaccatura stroke through it.
 */
export function drawFlag(
  sink: LayoutSink,
  beams: number,
  direction: StemDirection,
  x: number,
  tip: number,
  space: number,
  options: { scale?: number; slash?: boolean; node: Id },
): void {
  const name = flagGlyph(beams, direction);
  if (!name) return;
  const scale = options.scale ?? 1;
  const unit = space * scale;
  const left = x - stemThickness(space, scale) / 2;
  const origin = flagOrigin(name, direction, tip, unit);
  sink.primitives.push(glyph(name, left, origin, space, { scale, node: options.node }));
  if (!options.slash) return;
  const [from, to] =
    direction === 'up'
      ? [glyphAnchor('flag8thUp', 'graceNoteSlashSW'), glyphAnchor('flag8thUp', 'graceNoteSlashNE')]
      : [
          glyphAnchor('flag8thDown', 'graceNoteSlashNW'),
          glyphAnchor('flag8thDown', 'graceNoteSlashSE'),
        ];
  if (!from || !to) return;
  sink.primitives.push(
    line(
      left + from[0] * unit,
      origin - from[1] * unit,
      left + to[0] * unit,
      origin - to[1] * unit,
      stemThickness(space, scale),
      { node: options.node },
    ),
  );
}
