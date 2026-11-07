import type { Beat } from '@reprise/model';

import { glyphMetrics, type GlyphName } from '../../metrics';
import { glyph, type LayoutSink } from '../../primitives';
import { articulationMarks, glyphHeight, tremoloGlyph } from '../effects';
import { positionY, type ChordPlan } from './chord';
import { SHORTENING, beamStep, stemLength, type StemDirection } from './rhythm';

/**
 * Articulations, in staff spaces: the gap from the note or stem, between stacked marks and
 * outside the staff lines, and the most a staccato on the stem side moves to reach a space.
 */
export const ARTICULATION = { clear: 0.5, stack: 0.25, outside: 0.5, snap: 1 } as const;
/**
 * Tremolo strokes, in staff spaces: the free stem kept past the head's edge, the margin around
 * the strokes, and a whole note's gap from its head.
 */
export const TREMOLO = { gap: 0.5, margin: 0.25, whole: 1 } as const;

/** A beat's staccato and accent, on one side of its notes. */
export interface ArticulationPlan {
  above: boolean;
  /** With two or more voices and on drums, beyond the stem's tip or beam. */
  stemSide: boolean;
  /** The marks' centre, from the beat's x. */
  x: number;
  staccato?: GlyphName;
  accent?: GlyphName;
  /** Where the stack starts: the outer head's edge, or for a stem, its tip, known at render. */
  edge: number;
  /** On the head side, the staccato's centre, in a space beyond the outer head. */
  staccatoY?: number;
}

export interface TremoloPlan {
  glyph: GlyphName;
  /** Where the free stem starts, past the note nearest the tip, from the top line. */
  start: number;
  /** The strokes' centre, when the plan knows it: an unbeamed stem or a whole note. */
  y?: number;
}

const sign = (direction: StemDirection | boolean): number =>
  direction === 'up' || direction === true ? -1 : 1;

function headTop(name: GlyphName, unit: number): number {
  return glyphMetrics(name).bbox.top * unit;
}

function headBottom(name: GlyphName, unit: number): number {
  return -glyphMetrics(name).bbox.bottom * unit;
}

/** The outer edge of a chord's heads on one side, from the top line. */
export function outerHeadEdge(chord: ChordPlan, above: boolean): number {
  const unit = chord.space * chord.scale;
  return above
    ? Math.min(...chord.heads.map((head) => head.y - headTop(head.glyph, unit)))
    : Math.max(...chord.heads.map((head) => head.y + headBottom(head.glyph, unit)));
}

/** The articulations a beat shows, on the head side or beyond its stem, or undefined. */
export function planArticulation(
  beat: Beat,
  chord: ChordPlan,
  stemSide: boolean,
  space: number,
): ArticulationPlan | undefined {
  const { staccato, accent } = articulationMarks(beat.notes);
  if (!staccato && accent === undefined) return undefined;
  const up = chord.direction === 'up';
  const above = stemSide ? up : !up;
  const plan: ArticulationPlan = {
    above,
    stemSide,
    x: stemSide && chord.stem ? chord.stem.x : 0,
    edge: outerHeadEdge(chord, above),
  };
  if (staccato) plan.staccato = above ? 'articStaccatoAbove' : 'articStaccatoBelow';
  if (accent === 'heavy') plan.accent = above ? 'articMarcatoAbove' : 'articMarcatoBelow';
  else if (accent === 'accent') plan.accent = above ? 'articAccentAbove' : 'articAccentBelow';
  if (!stemSide) {
    const positions = chord.heads.map((head) => head.position);
    const outer = above ? Math.max(...positions) : Math.min(...positions);
    const step = outer % 2 === 0 ? 3 : 2;
    plan.staccatoY = positionY(above ? outer + step : outer - step, space);
  }
  return plan;
}

/** A glyph's origin y that puts its centre at `y`. */
function centred(name: GlyphName, y: number, space: number): number {
  const { bbox } = glyphMetrics(name);
  return y + ((bbox.top + bbox.bottom) / 2) * space;
}

/**
 * The marks of an articulation stacked outward from `edge`: the staccato nearest, then the
 * accent clear of it and outside the staff lines. Returns each glyph's origin y and the stack's
 * far edge, from the top line.
 */
export function stackArticulation(
  plan: ArticulationPlan,
  edge: number,
  space: number,
): { marks: { glyph: GlyphName; y: number }[]; far: number } {
  const s = sign(plan.above);
  const marks: { glyph: GlyphName; y: number }[] = [];
  let near = edge + s * ARTICULATION.clear * space;
  let far = edge;
  if (plan.staccato) {
    const half = (glyphHeight(plan.staccato) * space) / 2;
    let centre = plan.staccatoY ?? edge + s * (ARTICULATION.clear * space + half);
    if (plan.staccatoY === undefined && centre > 0 && centre < 4 * space) {
      // Into the next space outward: a staccato inside the staff never sits on a line.
      const index = centre / space - 0.5;
      centre = ((plan.above ? Math.floor(index) : Math.ceil(index)) + 0.5) * space;
    }
    marks.push({ glyph: plan.staccato, y: centred(plan.staccato, centre, space) });
    far = centre + s * half;
    near = far + s * ARTICULATION.stack * space;
  }
  if (plan.accent) {
    const { bbox } = glyphMetrics(plan.accent);
    near = plan.above
      ? Math.min(near, -ARTICULATION.outside * space)
      : Math.max(near, 4 * space + ARTICULATION.outside * space);
    const y = plan.above ? near + bbox.bottom * space : near + bbox.top * space;
    marks.push({ glyph: plan.accent, y });
    far = plan.above ? y - bbox.top * space : y - bbox.bottom * space;
  }
  return { marks, far };
}

/** How far the articulation can reach at render, from the top line, for measuring. */
export function articulationReach(plan: ArticulationPlan, edge: number, space: number): number {
  const { far } = stackArticulation(plan, edge, space);
  if (!plan.stemSide || !plan.staccato) return far;
  return far + sign(plan.above) * ARTICULATION.snap * space;
}

/** Half the widest mark of the articulation, in px. */
export function articulationHalf(plan: ArticulationPlan, space: number): number {
  const widths = [plan.staccato, plan.accent].flatMap((name) => {
    if (!name) return [];
    const { bbox } = glyphMetrics(name);
    return [(bbox.right - bbox.left) * space];
  });
  return Math.max(0, ...widths) / 2;
}

export function drawArticulation(
  sink: LayoutSink,
  plan: ArticulationPlan,
  x: number,
  top: number,
  edge: number,
  space: number,
  node: string,
): number {
  const { marks, far } = stackArticulation(plan, edge, space);
  for (const mark of marks) {
    const { bbox } = glyphMetrics(mark.glyph);
    const left = x + plan.x - ((bbox.left + bbox.right) / 2) * space;
    sink.primitives.push(glyph(mark.glyph, left, top + mark.y, space, { node }));
  }
  return top + far;
}

function tremoloHeight(name: GlyphName, space: number): number {
  return glyphHeight(name) * space;
}

/** Where a stem's free part starts: past the edge of the head nearest its tip. */
function freeStart(chord: ChordPlan, head: number, space: number): number {
  return head + sign(chord.direction) * (0.5 + TREMOLO.gap) * space;
}

/** How much a free stem from `start` to `inner` must grow to hold `name` with its margins, in px. */
function shortfall(name: GlyphName, start: number, inner: number, space: number): number {
  return Math.max(
    0,
    tremoloHeight(name, space) + 2 * TREMOLO.margin * space - Math.abs(inner - start),
  );
}

/**
 * A beat's tremolo strokes: on an unbeamed stem, centred in its free part, lengthening the stem
 * when they do not fit; beside a whole note's head on its direction's side. A beamed stem's are
 * placed at render, once the beam has moved out by `beamedShortfall`. Changes `chord` in place.
 */
export function planTremolo(
  beat: Beat,
  chord: ChordPlan,
  beamed: boolean,
  space: number,
): TremoloPlan | undefined {
  const name = tremoloGlyph(beat);
  if (!name) return undefined;
  const s = sign(chord.direction);
  const height = tremoloHeight(name, space);
  if (!chord.stem) {
    const edge = outerHeadEdge(chord, s < 0) + s * TREMOLO.whole * space;
    const y = edge + (s * height) / 2;
    if (s < 0) chord.top = Math.min(chord.top, y - height / 2);
    else chord.bottom = Math.max(chord.bottom, y + height / 2);
    return { glyph: name, start: edge, y };
  }
  const start = freeStart(chord, chord.stem.head, space);
  if (beamed) return { glyph: name, start };
  const inner = chord.tip - s * chord.beams * beamStep(space);
  const grow = shortfall(name, start, inner, space);
  chord.tip += s * grow;
  if (s < 0) chord.top = Math.min(chord.top, chord.tip);
  else chord.bottom = Math.max(chord.bottom, chord.tip);
  return { glyph: name, start, y: (start + inner + s * grow) / 2 };
}

/**
 * How far a beamed stem's beam must move out to hold the stem's tremolo strokes, against the
 * shortest stem a beam allows: an upper bound on what the exact beam needs.
 */
export function beamedShortfall(plan: TremoloPlan, chord: ChordPlan, space: number): number {
  if (!chord.stem) return 0;
  const s = sign(chord.direction);
  const shortest = (stemLength(chord.beams) - SHORTENING) * space;
  const inner = chord.stem.head + s * shortest - s * chord.beams * beamStep(space);
  return shortfall(plan.glyph, plan.start, inner, space);
}

/** Tremolo strokes centred on the stem at `x`, at `y` from the top line. */
export function drawTremolo(
  sink: LayoutSink,
  name: GlyphName,
  x: number,
  y: number,
  space: number,
  node: string,
): void {
  const { bbox } = glyphMetrics(name);
  const left = x - ((bbox.left + bbox.right) / 2) * space;
  sink.primitives.push(glyph(name, left, centred(name, y, space), space, { node }));
}

/** The centre of a beamed stem's strokes: midway between its free start and the beams' inner edge. */
export function beamedTremoloY(
  plan: TremoloPlan,
  chord: ChordPlan,
  tip: number,
  space: number,
): number {
  const inner = tip - sign(chord.direction) * chord.beams * beamStep(space);
  return (plan.start + inner) / 2;
}
