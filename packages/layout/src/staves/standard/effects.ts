import {
  TIE_REACH_BARS,
  tieOriginOf,
  type Bar,
  type Beat,
  type Note,
  type TieLink,
  type TiePosition,
  type Track,
} from '@reprise/model';

import { glyphMetrics, type GlyphName } from '../../metrics';
import { glyph, glyphWidth, line, type LayoutSink } from '../../primitives';
import {
  BEND_FRAME,
  articulationMarks,
  connections,
  drawBend,
  drawLetter,
  drawStroke,
  glyphHeight,
  hammerLetter,
  nextOnString,
  shifts,
  targetIsHigher,
  tickOf,
  tremoloGlyph,
  voiceBeats,
} from '../effects';
import type { StaffBar, StaffBarPlacement } from '../staff-module';
import {
  headEdges,
  headGlyph,
  loneHeadRight,
  mainHeads,
  positionY,
  tieDirection,
  type ChordPlan,
  type HeadPlan,
} from './chord';
import { placeNote } from './pitch';
import type { BarPlan, BeatPlan } from './plan';
import {
  SHORTENING,
  beamStep,
  dotsWidth,
  drawSlur,
  flagReach,
  stemEnd,
  stemLength,
  type ArcDirection,
  type StemDirection,
} from './rhythm';

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
function shortfall(
  name: GlyphName,
  start: number,
  inner: number,
  space: number,
  s: number,
): number {
  return Math.max(0, tremoloHeight(name, space) + 2 * TREMOLO.margin * space - s * (inner - start));
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
  const inner =
    (chord.beams > 2
      ? flagReach(chord.beams, chord.direction, chord.tip, chord.space, chord.scale)
      : undefined) ?? chord.tip - s * chord.beams * beamStep(space);
  const grow = shortfall(name, start, inner, space, s);
  chord.tip += s * grow;
  const end = stemEnd(chord.tip, chord.beams, chord.direction, chord.space, chord.scale);
  if (s < 0) chord.top = Math.min(chord.top, end);
  else chord.bottom = Math.max(chord.bottom, end);
  return { glyph: name, start, y: (start + inner + s * grow) / 2 };
}

/**
 * How far a beamed stem's beam must move out to hold the stem's tremolo strokes, against the
 * shortest stem a beam allows, clamped to the middle line as `beamLine` clamps it: an upper bound
 * on what the exact beam needs.
 */
export function beamedShortfall(plan: TremoloPlan, chord: ChordPlan, space: number): number {
  if (!chord.stem) return 0;
  const s = sign(chord.direction);
  const shortest = (stemLength(chord.beams) - SHORTENING) * space;
  const reached = chord.stem.head + s * shortest;
  const middle = positionY(4, space);
  const tip = s < 0 ? Math.min(reached, middle) : Math.max(reached, middle);
  const inner = tip - s * chord.beams * beamStep(space);
  return shortfall(plan.glyph, plan.start, inner, space, s);
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

/**
 * Slides, in staff spaces: the gap at a head, a loose slide's length, its gap from the head and
 * its drop, the line's thickness, and the room it takes beside the chord.
 */
export const SLIDE = {
  gap: 0.15,
  length: 1.3,
  clear: 0.2,
  drop: 0.5,
  thickness: 0.12,
  room: 1.5,
} as const;
/** The arpeggio or brush column's width and how far it reaches past the outer heads, in spaces. */
export const STROKE = { width: 1, reach: 0.9 } as const;
const TIE_GAP = 0.15;

/**
 * `tieOriginOf` within this bar and the one before: the origin a connection is drawn from in one
 * piece. Measuring reads no further back.
 */
export function nearOrigin(
  track: Track,
  barIndex: number,
  voice: number,
  beat: number,
  note: Note,
): TieLink | undefined {
  const here = track.bars[barIndex];
  if (!here) return undefined;
  const before = track.bars[barIndex - 1];
  const bars: Bar[] = before ? [before, here] : [here];
  const found = tieOriginOf(
    { kind: track.kind, bars },
    { bar: bars.length - 1, voice, beat },
    note,
  );
  return found && { ...found, bar: found.bar + barIndex - (bars.length - 1) };
}

export interface ConnectionContext {
  input: StaffBar;
  placement: StaffBarPlacement;
  plan: BarPlan;
  sink: LayoutSink;
  space: number;
  beatX: (beat: BeatPlan) => number;
  /** How far the previous bar moved a voice's beat right, for a unison or a second. */
  previousShift: (voice: number, beat: number) => number;
}

/** A head's place for a connection, in px: its centre's y and its outer edges, accidental and dots included. */
interface HeadSpot {
  y: number;
  left: number;
  right: number;
  direction: ArcDirection;
}

function spotOf(
  context: ConnectionContext,
  chord: ChordPlan,
  head: HeadPlan,
  x: number,
  dots: number,
): HeadSpot {
  const { placement, plan, space } = context;
  const edges = headEdges(chord, head);
  const left = Math.min(edges.left, head.accidental?.left ?? edges.left);
  const right =
    dots > 0
      ? Math.max(edges.right, chord.dots.x + dotsWidth(dots, space, chord.scale))
      : edges.right;
  return {
    y: placement.top + head.y,
    left: x + left,
    right: x + right,
    direction: tieDirection(chord, head, plan.multiVoice),
  };
}

/** Where the origin of a connection is drawn from, or undefined when it arrives as a half. */
function locate(
  context: ConnectionContext,
  beats: readonly BeatPlan[],
  voice: number,
  found: TieLink,
): HeadSpot | undefined {
  const { input, placement, space } = context;
  if (found.bar === input.barIndex) {
    const beat = beats[found.beat];
    const chord = beat?.chord;
    const head = chord && mainHeads(chord).find((other) => other.note === found.note);
    return beat && chord && head
      ? spotOf(context, chord, head, context.beatX(beat), beat.beat.dots)
      : undefined;
  }
  const { previous } = placement;
  const key = input.score.masterBars[found.bar]?.keySignature;
  if (found.bar !== input.barIndex - 1 || !previous || input.bar.clef !== undefined || !key) {
    return undefined;
  }
  const others = voiceBeats(input.track, found.bar, voice);
  const origin = others[found.beat];
  const x = previous.onsetX(tickOf(others, found.beat)) + context.previousShift(voice, found.beat);
  const width = glyphWidth(headGlyph('normal', origin?.duration ?? 4), space);
  const { position } = placeNote(input.track, found.note, key, input.clef, false);
  return {
    y: placement.top + positionY(position, space),
    left: x - width / 2,
    right: x + loneHeadRight(width, found.note.ghost, origin?.dots ?? 0, space),
    direction: 'down',
  };
}

/** Where a connection arriving from an earlier system starts: a space before the content, as a tie. */
function lineStart(context: ConnectionContext): number {
  return context.placement.x - context.space;
}

function slideLine(
  context: ConnectionContext,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  node: string,
): void {
  const { sink, space } = context;
  if (x1 - x0 < space * 0.2) return;
  sink.primitives.push(line(x0, y0, x1, y1, SLIDE.thickness * space, { node }));
}

function slur(
  context: ConnectionContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  direction: ArcDirection,
  node: string,
  letter: string | undefined,
): void {
  const { sink, space, input } = context;
  const apex = drawSlur(sink, x1, y1, x2, y2, direction, space, node);
  // Letters only when the staff is alone: in both mode the tab writes them (ADR-0022).
  if (apex === undefined || letter === undefined || input.staves.length > 1) return;
  drawLetter(sink, (x1 + x2) / 2, apex, direction, space, node, letter);
}

/** A slide into or out of a note from nowhere. */
function looseSlides(context: ConnectionContext, note: Note, spot: HeadSpot): void {
  const { space } = context;
  const before = spot.left - SLIDE.clear * space;
  const after = spot.right + SLIDE.clear * space;
  const length = SLIDE.length * space;
  const drop = SLIDE.drop * space;
  for (const kind of note.slide ?? []) {
    if (kind === 'intoFromBelow')
      slideLine(context, before - length, spot.y + drop, before, spot.y, note.id);
    if (kind === 'intoFromAbove')
      slideLine(context, before - length, spot.y - drop, before, spot.y, note.id);
    if (kind === 'outDown')
      slideLine(context, after, spot.y, after + length, spot.y + drop, note.id);
    if (kind === 'outUp') slideLine(context, after, spot.y, after + length, spot.y - drop, note.id);
  }
}

/**
 * A shift or legato slide from `origin` to `target`, whole, or from the bar's left edge when the
 * origin is not in reach; a legato slide adds its slur.
 */
function slideTo(
  context: ConnectionContext,
  originNote: Note,
  origin: HeadSpot | undefined,
  target: Note,
  spot: HeadSpot,
  slurDirection: ArcDirection,
): void {
  const { space } = context;
  const gap = SLIDE.gap * space;
  const higher = targetIsHigher(originNote, target);
  const end = spot.left - gap;
  if (origin) slideLine(context, origin.right + gap, origin.y, end, spot.y, target.id);
  else {
    const from = spot.y + (higher ? 1 : -1) * SLIDE.drop * space;
    slideLine(context, lineStart(context), from, end, spot.y, target.id);
  }
  if (!originNote.slide?.includes('legato')) return;
  const tie = TIE_GAP * space;
  const x1 = origin ? origin.right + tie : lineStart(context);
  const y1 = origin ? origin.y : spot.y;
  slur(context, x1, y1, spot.left - tie, spot.y, slurDirection, target.id, 'sl.');
}

/** Of a beat's hammer-on slurs going one way, only the outermost carries the letter. */
function lettered(chord: ChordPlan, multiVoice: boolean): Set<Note> {
  const out = new Set<Note>();
  const hammered = mainHeads(chord).filter((head) => head.note.hammerPull);
  const up = hammered.filter((head) => tieDirection(chord, head, multiVoice) === 'up');
  const down = hammered.filter((head) => tieDirection(chord, head, multiVoice) === 'down');
  const top = up.sort((a, b) => a.y - b.y)[0];
  const bottom = down.sort((a, b) => b.y - a.y)[0];
  if (top) out.add(top.note);
  if (bottom) out.add(bottom.note);
  return out;
}

/**
 * Slides, hammer-ons and pull-offs of one voice, drawn by the bar holding the target: in one
 * piece when the origin is in this bar, or in the previous bar of the system when this bar sets
 * no clef, and as a half from the bar's left edge otherwise; a bar ending a system draws the
 * origin half of each connection whose target is in the next bar. Shift, legato and hammer-on
 * connections follow a string, so only a fretted track draws them.
 */
export function drawConnections(
  context: ConnectionContext,
  voice: number,
  beats: readonly BeatPlan[],
): void {
  const { input, placement, plan, space } = context;
  const { track, barIndex } = input;
  const fretted = track.kind === 'fretted';
  const here = connections(track.bars[barIndex]);
  const slidesIn = fretted && (here.shifts || connections(track.bars[barIndex - 1]).shifts);
  const leavesLine =
    fretted && !placement.next && (here.shifts || connections(track.bars[barIndex + 1]).hammers);
  const tie = TIE_GAP * space;
  const contentEnd = placement.x + placement.width;
  for (const beat of beats) {
    const { chord } = beat;
    if (!chord) continue;
    const x = context.beatX(beat);
    const at: TiePosition = { bar: barIndex, voice, beat: beat.index };
    const letters = lettered(chord, plan.multiVoice);
    const lastGrace = beat.graces.at(-1);
    for (const head of mainHeads(chord)) {
      const { note } = head;
      const grace = lastGrace?.chord.heads.find(
        (other) => !other.sounding && other.note.string === note.string,
      );
      const connects = grace !== undefined || note.hammerPull || slidesIn || leavesLine;
      if (!note.slide && !connects) continue;
      const spot = spotOf(context, chord, head, x, beat.beat.dots);
      looseSlides(context, note, spot);
      if (!fretted) continue;
      if (grace && lastGrace) {
        const origin = spotOf(context, lastGrace.chord, grace, x + lastGrace.offset, 0);
        // A grace note's stem points up, so its slur bends down, away from it.
        if (shifts(grace.note)) slideTo(context, grace.note, origin, note, spot, 'down');
        if (note.hammerPull && !grace.note.slide?.includes('legato')) {
          const letter = letters.has(note) ? hammerLetter(grace.note, note) : undefined;
          slur(
            context,
            origin.right + tie,
            origin.y,
            spot.left - tie,
            spot.y,
            'down',
            note.id,
            letter,
          );
        }
      } else if (note.hammerPull || slidesIn) {
        const found = tieOriginOf(track, at, note);
        const near = found && found.bar >= barIndex - TIE_REACH_BARS ? found : undefined;
        if (near && (shifts(near.note) || note.hammerPull)) {
          const origin = locate(context, beats, voice, near);
          if (shifts(near.note) && near.bar >= barIndex - 1)
            slideTo(context, near.note, origin, note, spot, spot.direction);
          // A legato slide already draws its slur, labelled `sl.`.
          if (note.hammerPull && !near.note.slide?.includes('legato')) {
            const letter = letters.has(note) ? hammerLetter(near.note, note) : undefined;
            const x1 = origin ? origin.right + tie : lineStart(context);
            const y1 = origin ? origin.y : spot.y;
            slur(context, x1, y1, spot.left - tie, spot.y, spot.direction, note.id, letter);
          }
        }
      }
      if (!leavesLine) continue;
      const target = nextOnString(track, at, note);
      if (!target || target.bar === barIndex) continue;
      const hammer = target.note.hammerPull;
      if (shifts(note)) {
        const drop = (targetIsHigher(note, target.note) ? -1 : 1) * SLIDE.drop * space;
        slideLine(
          context,
          spot.right + SLIDE.gap * space,
          spot.y,
          contentEnd,
          spot.y + drop,
          note.id,
        );
      }
      if (hammer || note.slide?.includes('legato')) {
        slur(
          context,
          spot.right + tie,
          spot.y,
          contentEnd,
          spot.y,
          spot.direction,
          note.id,
          undefined,
        );
      }
    }
  }
}

/** Arpeggio waves and brush lines left of the chords, with their arrowheads. */
export function drawStrokes(context: ConnectionContext): void {
  const { plan, placement, sink, space } = context;
  for (const beat of plan.beats) {
    const { chord, strokeX } = beat;
    const stroke = beat.beat.effects.arpeggio ?? beat.beat.effects.brush;
    if (!chord || strokeX === undefined || !stroke) continue;
    const ys = mainHeads(chord).map((head) => placement.top + head.y);
    drawStroke(
      sink,
      context.beatX(beat) + strokeX,
      Math.min(...ys) - STROKE.reach * space,
      Math.max(...ys) + STROKE.reach * space,
      { direction: stroke.direction, arpeggio: beat.beat.effects.arpeggio !== undefined },
      space,
      beat.beat.id,
    );
  }
}

/**
 * Bends of one voice on a staff shown alone, one frame per beat and per grace column so equal
 * bends in a chord share their arrows: from right of the bent heads up into the bend lane, with
 * releases to zero ending above the highest bent head.
 */
export function drawBends(context: ConnectionContext, beats: readonly BeatPlan[]): void {
  const { placement, space } = context;
  const band = placement.lanes.bend;
  if (!band) return;
  const contentEnd = placement.x + placement.width;
  for (const [i, beat] of beats.entries()) {
    const { chord } = beat;
    if (!chord) continue;
    const x = context.beatX(beat);
    const drawn = new Set<string>();
    const following = beats[i + 1];
    const next = following ? context.beatX(following) : contentEnd;
    bendFrame(
      context,
      chord,
      x,
      beat.beat.dots,
      next - BEND_FRAME.stop * space,
      BEND_FRAME.min,
      band.bottom,
      drawn,
    );
    for (const [g, grace] of beat.graces.entries()) {
      const after = beat.graces[g + 1];
      const nextLeft = after ? x + after.offset + after.chord.left : x + chord.left;
      // A grace bend gets no minimum length: it would reach into the head it leads to.
      bendFrame(
        context,
        grace.chord,
        x + grace.offset,
        0,
        nextLeft - BEND_FRAME.graceStop * space,
        0,
        band.bottom,
        drawn,
      );
    }
  }
}

function bendFrame(
  context: ConnectionContext,
  chord: ChordPlan,
  x: number,
  dots: number,
  stop: number,
  min: number,
  laneBottom: number,
  drawn: Set<string>,
): void {
  const { sink, space, placement } = context;
  const bent = mainHeads(chord).filter((head) => head.note.bend);
  if (bent.length === 0) return;
  const spots = bent.map((head) => spotOf(context, chord, head, x, dots));
  const x0 = Math.max(...spots.map((spot) => spot.right)) + BEND_FRAME.gap * space;
  const xEnd = Math.max(stop, x0 + min * space);
  const unit = space * chord.scale;
  const tops = bent.map(
    (head) => placement.top + head.y - glyphMetrics(head.glyph).bbox.top * unit,
  );
  const releaseTop = Math.min(...tops);
  for (const [j, head] of bent.entries()) {
    const { bend } = head.note;
    const spot = spots[j];
    const numberTop = tops[j];
    if (!bend || !spot || numberTop === undefined) continue;
    drawBend(
      sink,
      bend,
      {
        x0,
        xEnd,
        yBase: spot.y,
        laneBottom,
        onset: x,
        numberTop,
        releaseTop,
        tied: head.note.tie,
      },
      space,
      head.note.id,
      drawn,
    );
  }
}
