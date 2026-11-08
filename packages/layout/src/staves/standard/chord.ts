import type { Alter, Duration, Note, NoteHead } from '@reprise/model';

import { engraving, glyphAnchor, glyphMetrics, type GlyphName } from '../../metrics';
import { glyphWidth } from '../../primitives';
import { beamCount } from '../rhythm';
import type { ShownAccidental } from './pitch';
import {
  dotsWidth,
  flagGlyph,
  stemEnd,
  stemThickness,
  stemTip,
  type ArcDirection,
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
/** Gap between a ghost note's heads and its parentheses, in spaces. */
const PAREN_GAP = 0.1;
const PAREN_LEFT = glyphMetrics('noteheadParenthesisLeft').bbox;
const PAREN_RIGHT = glyphMetrics('noteheadParenthesisRight').bbox;

/** A head's left and right edges from the chord's x, its parentheses included. */
export function headEdges(chord: ChordPlan, head: HeadPlan): { left: number; right: number } {
  const unit = chord.space * chord.scale;
  const { parens } = chord;
  if (!head.ghost || !parens) return { left: head.left, right: head.left + head.width };
  return {
    left: parens.left + PAREN_LEFT.left * unit,
    right: parens.right + PAREN_RIGHT.right * unit,
  };
}

/**
 * How far a lone head of `width` reaches right of its onset, its parentheses and dots included:
 * for a connection whose origin is in a bar this one did not plan.
 */
export function loneHeadRight(width: number, ghost: boolean, dots: number, space: number): number {
  const half = width / 2;
  const parens = ghost ? half + (PAREN_GAP + PAREN_RIGHT.right - PAREN_RIGHT.left) * space : half;
  if (dots === 0) return parens;
  const room = ghost ? (PAREN_GAP + PAREN_LEFT.right - PAREN_LEFT.left) * space : 0;
  return Math.max(parens, half + room + dotsWidth(dots, space));
}

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
  /** The head's written alteration, which orders heads at one position. */
  alter: Alter;
  /** 0 on the normal side, 1 across the stem, 2 and beyond further out. */
  column: number;
  /**
   * A head shared with another voice's: its anchor keeps the part left or right of `at`, an x
   * from the chord's.
   */
  half?: { side: 'left' | 'right'; at: number };
  accidental?: { glyphs: GlyphName[]; left: number };
  /** The extra diamond at a harmonic's sounding pitch: drawn, but no anchor, tie or slur. */
  sounding?: true;
  /** A ghost note's head, drawn in parentheses. */
  ghost?: true;
}

/** A chord's heads, accidentals and stem, from its x and the staff's top line. */
export interface ChordPlan {
  heads: HeadPlan[];
  direction: StemDirection;
  scale: number;
  space: number;
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
  /** The x of the ghost parentheses' glyph origins, when a head is a ghost note's. */
  parens?: { left: number; right: number };
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
  alter: Alter;
  accidental?: ShownAccidental;
  sounding?: boolean;
  /** Overrides the note's own ghost parentheses, for a head that stands for a pitch, not the note. */
  ghost?: boolean;
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
  /** A beam group member: its stem ends at a beam, so no flag's room is reserved. */
  beamed?: boolean;
  /** Stems reach the middle line; not for grace notes. */
  reachMiddle: boolean;
  /** No stem, flag or beam, whatever the duration: the heads stand alone. */
  stemless?: boolean;
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
    if (!accidental) return [];
    const glyphs = accidentalGlyphs(accidental);
    const width = glyphs.reduce((sum, name) => sum + glyphWidth(name, unit), 0);
    return [{ head, glyphs, width }];
  });
  if (marked.length === 0) return;
  // The signs at one position stack as one unit, in their heads' order left to right.
  const units: { members: typeof marked; span: [number, number]; width: number }[] = [];
  for (const entry of marked) {
    const span = verticalSpan(entry.glyphs, entry.head.y, unit);
    const last = units.at(-1);
    if (last && last.members[0]?.head.position === entry.head.position) {
      last.members.push(entry);
      last.span = [Math.min(last.span[0], span[0]), Math.max(last.span[1], span[1])];
      last.width += COLUMN_GAP * unit + entry.width;
    } else {
      units.push({ members: [entry], span, width: entry.width });
    }
  }
  const headsLeft = Math.min(...heads.map((head) => head.left)) - clearance;
  const columns: { spans: [number, number][]; width: number; members: typeof units }[] = [];
  for (const i of stackingOrder(units.length)) {
    const entry = units[i];
    if (!entry) continue;
    const { span } = entry;
    let column = columns.find(({ spans }) =>
      spans.every(([top, bottom]) => span[1] <= top || span[0] >= bottom),
    );
    if (!column) {
      column = { spans: [], width: 0, members: [] };
      columns.push(column);
    }
    column.spans.push(span);
    column.width = Math.max(column.width, entry.width);
    column.members.push(entry);
  }
  let right = headsLeft - ACCIDENTAL_GAP * unit;
  for (const column of columns) {
    for (const { members } of column.members) {
      let cursor = right;
      for (const { head, glyphs, width } of [...members].reverse()) {
        head.accidental = { glyphs, left: cursor - width };
        cursor -= width + COLUMN_GAP * unit;
      }
    }
    right -= column.width + COLUMN_GAP * unit;
  }
}

function headExtent(name: GlyphName, unit: number): { width: number; top: number; bottom: number } {
  const { left, right, top, bottom } = glyphMetrics(name).bbox;
  return { width: (right - left) * unit, top: top * unit, bottom: -bottom * unit };
}

/**
 * Lays out the heads of one beat: stacked by staff position and set in columns, walking from the
 * stem's far end, each head taking the lowest column no placed head a second or unison away holds
 * (column 0 the normal side, 1 across the stem, 2 and beyond further out: right of an up stem or
 * of no stem, left of a down one); accidentals stacked in columns to the left, ledger lines, dots
 * and the unbeamed stem.
 */
export function planChord(notes: readonly ChordNote[], options: ChordOptions): ChordPlan {
  const { duration, direction, space, scale } = options;
  const unit = space * scale;
  // At one position, left to right: main heads before sounding diamonds, which draw no anchor;
  // the flatter alteration; the higher string number, so the order ignores edit history.
  const sorted = [...notes].sort(
    (a, b) =>
      a.position - b.position ||
      Number(a.sounding ?? false) - Number(b.sounding ?? false) ||
      a.alter - b.alter ||
      b.note.string - a.note.string,
  );
  const stemmed = duration >= 2 && !options.stemless;
  const up = direction === 'up';
  const st = stemThickness(space, scale);
  const glyphs = sorted.map(({ head }) => headGlyph(head, duration));
  const extents = glyphs.map((name) => headExtent(name, unit));
  const column = Math.max(0, ...extents.map(({ width }) => width));
  const normalLeft = -column / 2;

  const columns = sorted.map(() => 0);
  const fromTop = stemmed && !up;
  for (let k = 0; k < sorted.length; k++) {
    const i = fromTop ? sorted.length - 1 - k : k;
    const here = sorted[i]?.position ?? 0;
    // A bit per column; a chord never has 31 heads within a second of each other.
    let taken = 0;
    for (let m = 0; m < k; m++) {
      const j = fromTop ? sorted.length - 1 - m : m;
      if (Math.abs((sorted[j]?.position ?? 0) - here) <= 1) taken |= 1 << (columns[j] ?? 0);
    }
    let at = 0;
    while (taken & (1 << at)) at += 1;
    columns[i] = at;
  }

  const farIndex = up ? 0 : sorted.length - 1;
  const farGlyph = glyphs[farIndex] ?? 'noteheadBlack';
  const anchor = glyphAnchor(farGlyph, up ? 'stemUpSE' : 'stemDownNW');
  const stemX = up
    ? normalLeft + (anchor?.[0] ?? column / unit) * unit - st / 2
    : normalLeft + (anchor?.[0] ?? 0) * unit + st / 2;

  const heads: HeadPlan[] = sorted.map(({ note, position, sounding, head, alter, ghost }, i) => {
    const { width } = extents[i] ?? { width: column };
    const at = columns[i] ?? 0;
    // A harmonic's diamond is narrower than a black head; right-aligned, it still meets an up-stem.
    const narrow = head === 'diamond' && note.harmonic !== undefined && width < column;
    let left = stemmed && up && narrow ? stemX + st / 2 - width : normalLeft;
    let shared = 0;
    if (at > 0) {
      const beyond = (at - 1) * column;
      if (!stemmed) left = normalLeft + at * column;
      else left = up ? stemX - st / 2 + beyond : stemX + st / 2 - width - beyond;
      // Columns past the first abut rather than overlap.
      if (stemmed && at === 1) shared = up ? column / 2 - left : -(left + width - normalLeft);
    }
    return {
      note,
      position,
      y: positionY(position, space),
      glyph: glyphs[i] ?? 'noteheadBlack',
      left,
      width,
      shared,
      alter,
      column: at,
      ...(sounding && { sounding: true as const }),
      ...((ghost ?? note.ghost) && !sounding && { ghost: true as const }),
    };
  });
  const ghosts = heads.filter((head) => head.ghost);
  const parenRoom = ghosts.length > 0 ? (PAREN_GAP + PAREN_LEFT.right - PAREN_LEFT.left) * unit : 0;
  const offStaff = sorted.some(({ position }) => position <= -2 || position >= 10);
  placeAccidentals(
    heads,
    sorted.map(({ accidental }) => accidental),
    unit,
    (offStaff ? engraving.legerLineExtension * unit : 0) + parenRoom,
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
  const headsLeft = Math.min(...heads.map((head) => head.left));
  const parens =
    ghosts.length > 0
      ? {
          left: headsLeft - PAREN_GAP * unit - PAREN_LEFT.right * unit,
          right: headsRight + PAREN_GAP * unit - PAREN_RIGHT.left * unit,
        }
      : undefined;
  const dotRows = new Set<number>();
  for (const { position } of heads) {
    const onLine = position % 2 === 0;
    const row = onLine ? position + (options.multiVoice && !up ? -1 : 1) : position;
    dotRows.add(row);
  }
  const dots = {
    x: headsRight + parenRoom,
    ys: options.dots > 0 ? [...dotRows].sort((a, b) => b - a).map((p) => positionY(p, space)) : [],
  };

  const ledgers: ChordPlan['ledgers'] = [];
  const extension = engraving.legerLineExtension * unit;
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

  let left = Math.min(headsLeft - (ledgers.length > 0 ? extension : 0), headsLeft - parenRoom);
  let right = Math.max(
    headsRight + (ledgers.length > 0 ? extension : 0),
    dots.x + dotsWidth(options.dots, space, scale),
  );
  let top = Math.min(...heads.map((head, i) => head.y - (extents[i]?.top ?? unit / 2)));
  let bottom = Math.max(...heads.map((head, i) => head.y + (extents[i]?.bottom ?? unit / 2)));
  for (const head of ghosts) {
    top = Math.min(top, head.y - PAREN_LEFT.top * unit);
    bottom = Math.max(bottom, head.y - PAREN_LEFT.bottom * unit);
  }
  for (const head of heads) {
    if (!head.accidental) continue;
    left = Math.min(left, head.accidental.left);
    const [accTop, accBottom] = verticalSpan(head.accidental.glyphs, head.y, unit);
    top = Math.min(top, accTop);
    bottom = Math.max(bottom, accBottom);
  }
  if (stem) {
    const end = options.beamed ? tip : stemEnd(tip, beams, direction, space, scale);
    top = Math.min(top, end);
    bottom = Math.max(bottom, end);
    const flag = flagGlyph(beams, direction);
    if (flag) right = Math.max(right, stem.x - st / 2 + glyphWidth(flag, unit));
  }

  return {
    heads,
    direction,
    scale,
    space,
    beams,
    ...(stem && { stem }),
    tip,
    dots,
    ...(parens && { parens }),
    ledgers,
    left,
    right,
    top,
    bottom,
  };
}

/**
 * Whether one of the chord's accidentals or ghost parentheses, which stand left of its heads,
 * reaches the ledger line at `y`.
 */
export function crossesLedger(chord: ChordPlan, y: number): boolean {
  const unit = chord.space * chord.scale;
  const half = (engraving.legerLineThickness * unit) / 2;
  const crosses = ([top, bottom]: [number, number]): boolean => y + half > top && y - half < bottom;
  return chord.heads.some(
    (head) =>
      (head.accidental !== undefined &&
        crosses(verticalSpan(head.accidental.glyphs, head.y, unit))) ||
      (head.ghost === true &&
        crosses([head.y - PAREN_LEFT.top * unit, head.y - PAREN_LEFT.bottom * unit])),
  );
}

/** The heads drawn for the chord's notes, without harmonics' sounding diamonds. */
export function mainHeads(chord: ChordPlan): HeadPlan[] {
  return chord.heads.filter((head) => !head.sounding);
}

/** The side a tie or slur on `head` bulges: away from the stem, the outer heads outward. */
export function tieDirection(chord: ChordPlan, head: HeadPlan, multiVoice: boolean): ArcDirection {
  const up = chord.direction === 'up';
  if (multiVoice) return up ? 'up' : 'down';
  const heads = mainHeads(chord);
  const index = heads.indexOf(head);
  const count = heads.length;
  if (count === 1 || (count % 2 === 1 && index === (count - 1) / 2)) return up ? 'down' : 'up';
  return index >= count / 2 ? 'up' : 'down';
}
