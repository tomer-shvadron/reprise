import type { Duration, Id } from '@reprise/model';

import bravura from '../../metrics/bravura.json' with { type: 'json' };
import { engraving, glyphMetrics, type GlyphName } from '../../metrics';
import { glyph, line, path, polyline, rect, round, type LayoutSink } from '../../primitives';
import type { PathPrimitive, Rect, ThemeRole } from '../../types';

/** Which way stems point from the notes: `down` hangs below them, `up` rises above. */
export type StemDirection = 'up' | 'down';

interface Drawn {
  role?: ThemeRole;
  node?: Id;
}

const sign = (direction: StemDirection): number => (direction === 'down' ? 1 : -1);

/** Beams sit this far apart, edge to edge plus their thickness, in staff spaces. */
export const BEAM_PITCH = engraving.beamThickness + engraving.beamSpacing;
/** A partial beam's length, about a note head's width. */
const BEAMLET = 1.1;
const TUPLET_HOOK = 0.6;
const TUPLET_NUMBER_GAP = 0.3;
const DOT_SPACING = 0.5;
/** Tie height as a share of its span, and the limits it keeps within, in staff spaces. */
const TIE_RISE = 0.12;
const TIE_MIN_HEIGHT = 0.3;
export const TIE_MAX_HEIGHT = 0.6;

const p = (x: number, y: number): string => `${String(round(x))} ${String(round(y))}`;

/** A stem from `from` to `to` at `x`, both y in px. */
export function drawStem(
  sink: LayoutSink,
  x: number,
  from: number,
  to: number,
  space: number,
  options: Drawn & { scale?: number } = {},
): void {
  sink.primitives.push(
    line(x, from, x, to, engraving.stemThickness * space * (options.scale ?? 1), options),
  );
}

const FLAGS: Readonly<Record<number, readonly [GlyphName, GlyphName]>> = {
  8: ['flag8thUp', 'flag8thDown'],
  16: ['flag16thUp', 'flag16thDown'],
  32: ['flag32ndUp', 'flag32ndDown'],
  64: ['flag64thUp', 'flag64thDown'],
  128: ['flag128thUp', 'flag128thDown'],
  256: ['flag256thUp', 'flag256thDown'],
};

/** The SMuFL anchor where a flag meets its stem, in staff spaces, y up. */
function stemAnchor(name: GlyphName): readonly [number, number] {
  const metrics = bravura.glyphs[name];
  if ('anchors' in metrics) {
    const anchors: Partial<Record<string, readonly number[]>> = metrics.anchors;
    const point = anchors['stemDownSW'] ?? anchors['stemUpNW'];
    if (point?.[0] !== undefined && point[1] !== undefined) return [point[0], point[1]];
  }
  return [0, 0];
}

export function flagGlyph(duration: Duration, direction: StemDirection): GlyphName | undefined {
  const pair = FLAGS[duration];
  return pair && (direction === 'up' ? pair[0] : pair[1]);
}

/** Width of a flag to the right of its stem's x, in px. */
export function flagWidth(duration: Duration, space: number, scale = 1): number {
  const name = flagGlyph(duration, 'down');
  return name ? glyphMetrics(name).bbox.right * space * scale : 0;
}

/** The flag of an unbeamed `duration` on a stem at `x` ending at `end`. */
export function drawFlag(
  sink: LayoutSink,
  duration: Duration,
  x: number,
  end: number,
  direction: StemDirection,
  space: number,
  options: Drawn & { scale?: number } = {},
): void {
  const name = flagGlyph(duration, direction);
  if (!name) return;
  const scale = options.scale ?? 1;
  const unit = space * scale;
  const [ax, ay] = stemAnchor(name);
  const stemLeft = x - (engraving.stemThickness * unit) / 2;
  sink.primitives.push(
    glyph(name, stemLeft - ax * unit, end + ay * unit, space, { ...options, scale }),
  );
}

/** A stem of a beamed group: its x and how many beams it carries. */
export interface BeamedStem {
  x: number;
  beams: number;
}

/**
 * Horizontal beams across `stems`, whose stems all end at `end`: the primary beam on the stem
 * ends and each further one `BEAM_PITCH` towards the notes. A stem with more beams than both its
 * neighbours gets a partial beam, pointing right from the group's first stem and left elsewhere.
 */
export function drawBeams(
  sink: LayoutSink,
  stems: readonly BeamedStem[],
  end: number,
  direction: StemDirection,
  space: number,
  options: Drawn & { scale?: number } = {},
): void {
  const scale = options.scale ?? 1;
  const unit = space * scale;
  const half = (engraving.stemThickness * unit) / 2;
  const thickness = engraving.beamThickness * unit;
  const levels = Math.max(0, ...stems.map((stem) => stem.beams));
  for (let level = 0; level < levels; level++) {
    const edge = end - sign(direction) * level * BEAM_PITCH * unit;
    const top = direction === 'down' ? edge - thickness : edge;
    let i = 0;
    while (i < stems.length) {
      if ((stems[i]?.beams ?? 0) <= level) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < stems.length && (stems[j + 1]?.beams ?? 0) > level) j++;
      const first = stems[i];
      const last = stems[j];
      if (first && last) {
        let left = first.x - half;
        let right = last.x + half;
        if (i === j) {
          const towardsRight = i === 0;
          left = towardsRight ? first.x - half : first.x + half - BEAMLET * unit;
          right = towardsRight ? first.x - half + BEAMLET * unit : first.x + half;
        }
        sink.primitives.push(beam(rect(left, top, right - left, thickness), options));
      }
      i = j + 1;
    }
  }
}

function beam(area: Rect, options: Drawn): PathPrimitive {
  const { x, y, width, height } = area;
  return path(
    `M${p(x, y)}h${String(width)}v${String(height)}h${String(-width)}Z`,
    area,
    true,
    0,
    options,
  );
}

/** Augmentation dots from `x` rightwards, centred on `y`. */
export function drawDots(
  sink: LayoutSink,
  count: number,
  x: number,
  y: number,
  space: number,
  options: Drawn & { scale?: number } = {},
): void {
  const unit = space * (options.scale ?? 1);
  for (let i = 0; i < count; i++) {
    sink.primitives.push(glyph('augmentationDot', x + i * DOT_SPACING * unit, y, space, options));
  }
}

/** Width of `count` dots drawn by `drawDots`, in px. */
export function dotsWidth(count: number, space: number, scale = 1): number {
  if (count === 0) return 0;
  return ((count - 1) * DOT_SPACING + glyphMetrics('augmentationDot').advance) * space * scale;
}

function tupletDigits(n: number): GlyphName[] {
  return Array.from(String(n), (digit): GlyphName => {
    switch (digit) {
      case '0':
        return 'tuplet0';
      case '1':
        return 'tuplet1';
      case '2':
        return 'tuplet2';
      case '3':
        return 'tuplet3';
      case '4':
        return 'tuplet4';
      case '5':
        return 'tuplet5';
      case '6':
        return 'tuplet6';
      case '7':
        return 'tuplet7';
      case '8':
        return 'tuplet8';
      default:
        return 'tuplet9';
    }
  });
}

/**
 * A tuplet's number centred between `left` and `right` on the line `y`, and, with `bracket`, a
 * bracket along that line whose hooks point back towards the stems (up when `direction` is down).
 */
export function drawTuplet(
  sink: LayoutSink,
  n: number,
  left: number,
  right: number,
  y: number,
  direction: StemDirection,
  space: number,
  options: Drawn & { bracket?: boolean } = {},
): void {
  const digits = tupletDigits(n);
  const width = digits.reduce((sum, name) => sum + glyphMetrics(name).advance * space, 0);
  const centre = (left + right) / 2;
  let x = centre - width / 2;
  for (const name of digits) {
    const { bbox, advance } = glyphMetrics(name);
    sink.primitives.push(
      glyph(name, x, y + ((bbox.top + bbox.bottom) / 2) * space, space, options),
    );
    x += advance * space;
  }
  if (!options.bracket) return;
  const hook = y - sign(direction) * TUPLET_HOOK * space;
  const gap = TUPLET_NUMBER_GAP * space;
  const thickness = engraving.tupletBracketThickness * space;
  sink.primitives.push(
    polyline(
      [
        [left, hook],
        [left, y],
        [centre - width / 2 - gap, y],
      ],
      thickness,
      options,
    ),
    polyline(
      [
        [centre + width / 2 + gap, y],
        [right, y],
        [right, hook],
      ],
      thickness,
      options,
    ),
  );
}

/**
 * A tie from (`left`, `y`) to (`right`, `y`), bulging `direction`: a filled crescent, thin at the
 * ends and Bravura's tie midpoint thickness at the middle.
 */
/** How far a tie or slur spanning `span` px bulges from its ends. */
export function tieHeight(span: number, space: number): number {
  return Math.min(TIE_MAX_HEIGHT * space, Math.max(TIE_MIN_HEIGHT * space, TIE_RISE * span));
}

export function drawTie(
  sink: LayoutSink,
  left: number,
  right: number,
  y: number,
  direction: StemDirection,
  space: number,
  options: Drawn = {},
): void {
  if (right - left < space * 0.2) return;
  const s = sign(direction);
  const height = tieHeight(right - left, space);
  // A symmetric cubic reaches three quarters of its control points' offset.
  const outer = (height * 4) / 3;
  const inner = ((height - engraving.tieMidpointThickness * space) * 4) / 3;
  const inset = (right - left) / 4;
  const d =
    `M${p(left, y)}` +
    `C${p(left + inset, y + s * outer)} ${p(right - inset, y + s * outer)} ${p(right, y)}` +
    `C${p(right - inset, y + s * inner)} ${p(left + inset, y + s * inner)} ${p(left, y)}Z`;
  const top = s > 0 ? y : y - height;
  sink.primitives.push(path(d, rect(left, top, right - left, height), true, 0, options));
}
