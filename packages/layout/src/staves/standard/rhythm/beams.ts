import type { Id } from '@reprise/model';

import { engraving } from '../../../metrics';
import type { LayoutSink } from '../../../primitives';
import { polygon } from './shapes';
import { stemLength, stemThickness, type StemDirection } from './stems';

/** One stem of a beamed group: its centre line and the y of the note head nearest the beam. */
export interface BeamStem {
  x: number;
  head: number;
  beams: number;
}

/** The beam's outer edge (the stems' tips) at the first and the last stem. */
export interface BeamLine {
  start: number;
  end: number;
}

export interface BeamOptions {
  space: number;
  scale?: number;
  /** The staff's middle line: a beam reaches at least that far. */
  middle?: number;
  /**
   * Fit the beam to the stems' actual x positions. Without it the inner stems may sit anywhere
   * between the ends, and the line is placed so it clears them wherever they are: an outer bound
   * on the exact line, for measuring before the bar is spaced.
   */
  exact: boolean;
}

/** The longest a beam may rise or fall over its length, in staff spaces. */
const MAX_SLOPE = 1;
/** A stem under a beam may be this much shorter than an unbeamed one, in staff spaces. */
const SHORTENING = 0.5;

/**
 * Places a beam over `stems`: each end `stemLength` from its note (and reaching the middle line),
 * the slope following the first and last notes but no steeper than one staff space, horizontal
 * when they are the same pitch or an inner note is further out than both, and the whole line
 * moved out until no stem is shorter than the minimum.
 */
export function beamLine(
  stems: readonly BeamStem[],
  direction: StemDirection,
  options: BeamOptions,
): BeamLine {
  const { space, middle, exact } = options;
  const scale = options.scale ?? 1;
  const first = stems[0];
  const last = stems.at(-1);
  if (!first || !last) return { start: 0, end: 0 };
  const up = direction === 'up';
  const beams = Math.max(...stems.map((stem) => stem.beams));
  const ideal = stemLength(beams) * space * scale;
  const shortest = ideal - SHORTENING * space * scale;
  const reach = (head: number, length: number): number => {
    const tip = up ? head - length : head + length;
    if (middle === undefined) return tip;
    return up ? Math.min(tip, middle) : Math.max(tip, middle);
  };

  const from = reach(first.head, ideal);
  const to = reach(last.head, ideal);
  const inner = stems.slice(1, -1);
  const outermost = up
    ? inner.some((stem) => stem.head < Math.min(first.head, last.head))
    : inner.some((stem) => stem.head > Math.max(first.head, last.head));
  const limit = MAX_SLOPE * space * scale;
  const slope =
    first.head === last.head || outermost ? 0 : Math.max(-limit, Math.min(limit, to - from));

  const span = last.x - first.x;
  let offset = up ? Math.min(from, to - slope) : Math.max(from, to - slope);
  for (const [i, stem] of stems.entries()) {
    const required = reach(stem.head, shortest);
    let shift: number;
    if (i === 0) shift = 0;
    else if (i === stems.length - 1) shift = slope;
    else if (exact) shift = span > 0 ? (slope * (stem.x - first.x)) / span : 0;
    else shift = up ? Math.max(0, slope) : Math.min(0, slope);
    offset = up ? Math.min(offset, required - shift) : Math.max(offset, required - shift);
  }
  return { start: offset, end: offset + slope };
}

/** The beam's outer edge at `x`. */
export function beamY(stems: readonly BeamStem[], beam: BeamLine, x: number): number {
  const first = stems[0];
  const last = stems.at(-1);
  if (!first || !last || last.x === first.x) return beam.start;
  return beam.start + ((beam.end - beam.start) * (x - first.x)) / (last.x - first.x);
}

/** Distance between the outer edges of two neighbouring beams, in px. */
export function beamStep(space: number, scale = 1): number {
  return (engraving.beamThickness + engraving.beamSpacing) * space * scale;
}

const PARTIAL_LENGTH = 1.1;

/**
 * Every beam of a group: a full beam where consecutive stems share a level, and a partial one
 * for a stem alone at its level, pointing right from the first stem and left elsewhere.
 */
export function drawBeams(
  sink: LayoutSink,
  stems: readonly BeamStem[],
  direction: StemDirection,
  beam: BeamLine,
  space: number,
  options: { scale?: number; node: Id },
): void {
  const scale = options.scale ?? 1;
  const inward = direction === 'up' ? 1 : -1;
  const thickness = engraving.beamThickness * space * scale;
  const halfStem = stemThickness(space, scale) / 2;
  const levels = Math.max(0, ...stems.map((stem) => stem.beams));
  const bar = (level: number, x1: number, x2: number): void => {
    const offset = (level - 1) * beamStep(space, scale) * inward;
    const y1 = beamY(stems, beam, x1) + offset;
    const y2 = beamY(stems, beam, x2) + offset;
    sink.primitives.push(
      polygon(
        [
          [x1, y1],
          [x2, y2],
          [x2, y2 + inward * thickness],
          [x1, y1 + inward * thickness],
        ],
        options.node,
      ),
    );
  };
  for (let level = 1; level <= levels; level++) {
    let i = 0;
    while (i < stems.length) {
      if ((stems[i]?.beams ?? 0) < level) {
        i += 1;
        continue;
      }
      let j = i;
      while (j + 1 < stems.length && (stems[j + 1]?.beams ?? 0) >= level) j += 1;
      const a = stems[i];
      const b = stems[j];
      if (a && b && j > i) {
        bar(level, a.x - halfStem, b.x + halfStem);
      } else if (a) {
        const right = i === 0;
        const neighbour = stems[right ? i + 1 : i - 1];
        const room = neighbour ? Math.abs(neighbour.x - a.x) / 2 : PARTIAL_LENGTH * space;
        const length = Math.min(PARTIAL_LENGTH * space * scale, room);
        if (right) bar(level, a.x - halfStem, a.x + length);
        else bar(level, a.x - length, a.x + halfStem);
      }
      i = j + 1;
    }
  }
}
