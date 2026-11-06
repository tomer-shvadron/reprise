import type { Alter, Duration, Note, NoteHead } from '@reprise/model';

import { engraving, glyphAnchor, glyphMetrics, type GlyphName } from '../../metrics';
import { glyphWidth } from '../../primitives';
import type { ShownAccidental } from './pitch';
import {
  beamCount,
  dotsWidth,
  flagGlyph,
  stemThickness,
  stemTip,
  type StemDirection,
} from './rhythm';

/** y of staff position `position` below the top line of a five-line staff, in px. */
export function positionY(position: number, space: number): number {
  return ((8 - position) * space) / 2;
}

const HEADS: Record<NoteHead, readonly [GlyphName, GlyphName, GlyphName]> = {
  normal: ['noteheadWhole', 'noteheadHalf', 'noteheadBlack'],
  cross: ['noteheadXWhole', 'noteheadXHalf', 'noteheadXBlack'],
  diamond: ['noteheadDiamondWhole', 'noteheadDiamondHalf', 'noteheadDiamondBlack'],
  triangle: ['noteheadTriangleUpWhole', 'noteheadTriangleUpHalf', 'noteheadTriangleUpBlack'],
};

export function headGlyph(head: NoteHead, duration: Duration): GlyphName {
  const [whole, half, black] = HEADS[head];
  if (duration === 1) return whole;
  return duration === 2 ? half : black;
}

const ACCIDENTALS: Record<Alter, GlyphName> = {
  [-2]: 'accidentalDoubleFlat',
  [-1]: 'accidentalFlat',
  0: 'accidentalNatural',
  1: 'accidentalSharp',
  2: 'accidentalDoubleSharp',
};

export function accidentalGlyphs(shown: ShownAccidental): GlyphName[] {
  const sign = ACCIDENTALS[shown.alter];
  return shown.courtesy ? ['accidentalParensLeft', sign, 'accidentalParensRight'] : [sign];
}

/** Gap between an accidental and its note head, and between accidental columns, in spaces. */
const ACCIDENTAL_GAP = 0.2;
const COLUMN_GAP = 0.1;

export interface HeadPlan {
  note: Note;
  position: number;
  /** Centre y, from the staff's top line. */
  y: number;
  glyph: GlyphName;
  /** Left edge, from the chord's x. */
  left: number;
  width: number;
  /**
   * How much of the head's width it shares with a neighbour across the stem, on its left (+) or
   * right (-) edge; its anchor leaves that part to the neighbour.
   */
  shared: number;
  accidental?: { glyphs: GlyphName[]; left: number };
}

/** A chord's heads, accidentals and stem, from its x and the staff's top line. */
export interface ChordPlan {
  heads: HeadPlan[];
  direction: StemDirection;
  scale: number;
  /** Beams or flags its duration carries. */
  beams: number;
  stem?: {
    x: number;
    /** Where the stem leaves the head furthest from its tip. */
    from: number;
    /** Centre of the head nearest the tip. */
    head: number;
  };
  /** The unbeamed stem's tip. */
  tip: number;
  /** Where the rhythm dots start, and the y of each row. */
  dots: { x: number; ys: number[] };
  ledgers: { y: number; left: number; right: number }[];
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface ChordNote {
  note: Note;
  position: number;
  head: NoteHead;
  accidental?: ShownAccidental;
}

export interface ChordOptions {
  duration: Duration;
  dots: number;
  direction: StemDirection;
  space: number;
  scale: number;
  /** Two or more voices on the staff: dots on lines of a stem-down voice go to the space below. */
  multiVoice: boolean;
  /** Beams or flags drawn; a single grace note shows one whatever its value. */
  beams?: number;
  /** Stems reach the middle line; not for grace notes. */
  reachMiddle: boolean;
}

/** Order accidentals are stacked in: outermost first, alternating top and bottom. */
function stackingOrder(count: number): number[] {
  const order: number[] = [];
  let low = 0;
  let high = count - 1;
  while (low <= high) {
    order.push(high);
    high -= 1;
    if (low <= high) order.push(low);
    low += 1;
  }
  return order;
}

function verticalSpan(glyphs: readonly GlyphName[], y: number, unit: number): [number, number] {
  let top = y;
  let bottom = y;
  for (const name of glyphs) {
    const box = glyphMetrics(name).bbox;
    top = Math.min(top, y - box.top * unit);
    bottom = Math.max(bottom, y - box.bottom * unit);
  }
  return [top, bottom];
}

function placeAccidentals(
  heads: HeadPlan[],
  shown: readonly (ShownAccidental | undefined)[],
  unit: number,
  clearance: number,
): void {
  const marked = heads.flatMap((head, i) => {
    const accidental = shown[i];
    return accidental ? [{ head, glyphs: accidentalGlyphs(accidental) }] : [];
  });
  if (marked.length === 0) return;
  const headsLeft = Math.min(...heads.map((head) => head.left)) - clearance;
  const columns: { spans: [number, number][]; width: number; members: typeof marked }[] = [];
  for (const i of stackingOrder(marked.length)) {
    const entry = marked[i];
    if (!entry) continue;
    const span = verticalSpan(entry.glyphs, entry.head.y, unit);
    const width = entry.glyphs.reduce((sum, name) => sum + glyphWidth(name, unit), 0);
    let column = columns.find(({ spans }) =>
      spans.every(([top, bottom]) => span[1] <= top || span[0] >= bottom),
    );
    if (!column) {
      column = { spans: [], width: 0, members: [] };
      columns.push(column);
    }
    column.spans.push(span);
    column.width = Math.max(column.width, width);
    column.members.push(entry);
  }
  let right = headsLeft - ACCIDENTAL_GAP * unit;
  for (const column of columns) {
    for (const { head, glyphs } of column.members) {
      const width = glyphs.reduce((sum, name) => sum + glyphWidth(name, unit), 0);
      head.accidental = { glyphs, left: right - width };
    }
    right -= column.width + COLUMN_GAP * unit;
  }
}

function headExtent(name: GlyphName, unit: number): { width: number; top: number; bottom: number } {
  const { left, right, top, bottom } = glyphMetrics(name).bbox;
  return { width: (right - left) * unit, top: top * unit, bottom: -bottom * unit };
}

/**
 * Lays out the heads of one beat: stacked by staff position, a head a second (or unison) from
 * its neighbour moved to the other side of the stem (right of an up stem, left of a down one,
 * right when there is no stem), accidentals stacked in columns to the left, ledger lines, dots
 * and the unbeamed stem.
 */
export function planChord(notes: readonly ChordNote[], options: ChordOptions): ChordPlan {
  const { duration, direction, space, scale } = options;
  const unit = space * scale;
  const sorted = [...notes].sort((a, b) => a.position - b.position);
  const stemmed = duration >= 2;
  const up = direction === 'up';
  const st = stemThickness(space, scale);
  const glyphs = sorted.map(({ head }) => headGlyph(head, duration));
  const extents = glyphs.map((name) => headExtent(name, unit));
  const column = Math.max(0, ...extents.map(({ width }) => width));
  const normalLeft = -column / 2;

  const displaced = sorted.map(() => false);
  if (stemmed && !up) {
    for (let i = sorted.length - 2; i >= 0; i--) {
      const above = sorted[i + 1];
      const here = sorted[i];
      if (above && here && above.position - here.position <= 1 && !displaced[i + 1]) {
        displaced[i] = true;
      }
    }
  } else {
    for (let i = 1; i < sorted.length; i++) {
      const below = sorted[i - 1];
      const here = sorted[i];
      if (below && here && here.position - below.position <= 1 && !displaced[i - 1]) {
        displaced[i] = true;
      }
    }
  }

  const farIndex = up ? 0 : sorted.length - 1;
  const farGlyph = glyphs[farIndex] ?? 'noteheadBlack';
  const anchor = glyphAnchor(farGlyph, up ? 'stemUpSE' : 'stemDownNW');
  const stemX = up
    ? normalLeft + (anchor?.[0] ?? column / unit) * unit - st / 2
    : normalLeft + (anchor?.[0] ?? 0) * unit + st / 2;

  const heads: HeadPlan[] = sorted.map(({ note, position }, i) => {
    const { width } = extents[i] ?? { width: column };
    let left = normalLeft;
    let shared = 0;
    if (displaced[i]) {
      if (!stemmed) left = column / 2;
      else left = up ? stemX - st / 2 : stemX + st / 2 - width;
      shared = stemmed ? (up ? column / 2 - left : -(left + width - normalLeft)) : 0;
    }
    return {
      note,
      position,
      y: positionY(position, space),
      glyph: glyphs[i] ?? 'noteheadBlack',
      left,
      width,
      shared,
    };
  });
  const offStaff = sorted.some(({ position }) => position <= -2 || position >= 10);
  placeAccidentals(
    heads,
    sorted.map(({ accidental }) => accidental),
    unit,
    offStaff ? engraving.legerLineExtension * unit : 0,
  );

  const beams = options.beams ?? beamCount(duration);
  const lowest = heads[0];
  const highest = heads.at(-1);
  const middle = positionY(4, space);
  let stem: ChordPlan['stem'];
  let tip = middle;
  if (stemmed && lowest && highest) {
    const far = up ? lowest : highest;
    const near = up ? highest : lowest;
    stem = { x: stemX, from: far.y - (anchor?.[1] ?? 0) * unit, head: near.y };
    tip = stemTip(near.y, direction, beams, space, {
      scale,
      ...(options.reachMiddle && { middle }),
    });
  }

  const headsRight = Math.max(...heads.map((head) => head.left + head.width));
  const dotRows = new Set<number>();
  for (const { position } of heads) {
    const onLine = position % 2 === 0;
    const row = onLine ? position + (options.multiVoice && !up ? -1 : 1) : position;
    dotRows.add(row);
  }
  const dots = {
    x: headsRight,
    ys: options.dots > 0 ? [...dotRows].sort((a, b) => b - a).map((p) => positionY(p, space)) : [],
  };

  const ledgers: ChordPlan['ledgers'] = [];
  const extension = engraving.legerLineExtension * unit;
  const headsLeft = Math.min(...heads.map((head) => head.left));
  const low = lowest?.position ?? 4;
  const high = highest?.position ?? 4;
  for (let p = -2; p >= low; p -= 2) {
    ledgers.push({
      y: positionY(p, space),
      left: headsLeft - extension,
      right: headsRight + extension,
    });
  }
  for (let p = 10; p <= high; p += 2) {
    ledgers.push({
      y: positionY(p, space),
      left: headsLeft - extension,
      right: headsRight + extension,
    });
  }

  let left = headsLeft - (ledgers.length > 0 ? extension : 0);
  let right = Math.max(
    headsRight + (ledgers.length > 0 ? extension : 0),
    headsRight + dotsWidth(options.dots, space, scale),
  );
  let top = Math.min(...heads.map((head, i) => head.y - (extents[i]?.top ?? unit / 2)));
  let bottom = Math.max(...heads.map((head, i) => head.y + (extents[i]?.bottom ?? unit / 2)));
  for (const head of heads) {
    if (!head.accidental) continue;
    left = Math.min(left, head.accidental.left);
    const [accTop, accBottom] = verticalSpan(head.accidental.glyphs, head.y, unit);
    top = Math.min(top, accTop);
    bottom = Math.max(bottom, accBottom);
  }
  if (stem) {
    top = Math.min(top, tip);
    bottom = Math.max(bottom, tip);
    const flag = flagGlyph(beams, direction);
    if (flag) right = Math.max(right, stem.x - st / 2 + glyphWidth(flag, unit));
  }

  return {
    heads,
    direction,
    scale,
    beams,
    ...(stem && { stem }),
    tip,
    dots,
    ledgers,
    left,
    right,
    top,
    bottom,
  };
}
