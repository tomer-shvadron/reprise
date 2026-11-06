import {
  TIE_REACH_BARS,
  beatTicks,
  tieOriginOf,
  type Bar,
  type Beat,
  type Note,
  type TiePosition,
  type Track,
} from '@reprise/model';

import { textExtent, textWidth } from '../../metrics';
import { ARROW_LENGTH, arrowhead, box, line, rect, text } from '../../primitives';
import { WAVES, drawBend, verticalWave } from '../effects';
import { drawTie, tieHeight, type StemDirection } from '../rhythm';
import {
  TAB,
  labelHalf,
  labelHalfHeight,
  labelOf,
  suffixRoom,
  type NoteLabel,
  type TabBeat,
  type TabVoice,
} from './analysis';
import { lineY, type TabContext } from './context';

/** Gaps and sizes of the on-string effects, in staff spaces. */
const SLIDE = { gap: 0.15, rise: 0.3, length: 1.3, clear: 0.2, thickness: 0.12 };
const BEND = { gap: 0.15, stop: 0.6, min: 1, graceStop: 0.3 };
const STROKE = { reach: 0.4, thickness: 0.12 };

/** The x of each grace column's centre, in column order, for a beat at `x`. */
export function graceCentres(beat: TabBeat, x: number, space: number): number[] {
  const centres: number[] = [];
  let cursor = x - beat.half - beat.stroke - TAB.graceGap * space;
  for (const column of [...beat.graces].reverse()) {
    cursor -= column.room;
    centres.unshift(cursor - column.width / 2);
    cursor -= column.width + TAB.graceGap * space;
  }
  return centres;
}

function contentEnd(context: TabContext): number {
  return context.placement.x + context.placement.width;
}

/** Where what follows a number starts: past its knockout and its suffix. */
function rightEdge(label: NoteLabel | undefined, size: number): number {
  if (!label || label.text === undefined) return 0;
  return labelHalf(label, size) + suffixRoom(label, size);
}

function leftEdge(label: NoteLabel | undefined, size: number): number {
  return label?.text === undefined ? 0 : labelHalf(label, size);
}

function voiceBeats(track: Track, bar: number, voice: number): readonly Beat[] {
  return track.bars[bar]?.voices[voice]?.beats ?? [];
}

function tickOf(beats: readonly Beat[], index: number): number {
  let tick = 0;
  for (const beat of beats.slice(0, index)) tick += beatTicks(beat);
  return tick;
}

/** The next note on `note`'s string in the voice: later in its bar, else in the next bar. */
function nextOnString(
  track: Track,
  at: TiePosition,
  note: Note,
): { note: Note; bar: number; beat: number } | undefined {
  for (let bar = at.bar; bar <= at.bar + 1; bar++) {
    const beats = voiceBeats(track, bar, at.voice);
    for (let i = bar === at.bar ? at.beat + 1 : 0; i < beats.length; i++) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const found = beat.notes.find((candidate) => candidate.string === note.string);
      if (found) return { note: found, bar, beat: i };
    }
  }
  return undefined;
}

const connectionsMemo = new WeakMap<Bar, { shifts: boolean; hammers: boolean }>();

/** Whether a bar holds the origin of a shift or legato slide, or the target of a hammer-on. */
function connections(bar: Bar | undefined): { shifts: boolean; hammers: boolean } {
  if (!bar) return { shifts: false, hammers: false };
  const known = connectionsMemo.get(bar);
  if (known) return known;
  const found = { shifts: false, hammers: false };
  for (const { beats } of bar.voices) {
    for (const beat of beats) {
      for (const note of beat.notes) {
        if (shifts(note)) found.shifts = true;
        if (note.hammerPull) found.hammers = true;
      }
    }
  }
  connectionsMemo.set(bar, found);
  return found;
}

function shifts(note: Note): boolean {
  return note.slide?.some((kind) => kind === 'shift' || kind === 'legato') ?? false;
}

function arcDirection(context: TabContext, note: Note): StemDirection {
  return note.string <= context.input.track.tuning.length / 2 ? 'up' : 'down';
}

/** An origin a connection is drawn from, located wherever it is relative to this bar. */
interface Origin {
  note: Note;
  /** Its x and the edge right of its number, or undefined when it is not in this system. */
  x?: number;
  edge: number;
}

/**
 * The connection's arc from `left` to `right` on the note's string, with a letter outside its
 * apex over a paper knockout so the string lines stop short of it.
 */
function drawArc(
  context: TabContext,
  note: Note,
  left: number,
  right: number,
  letter: string | undefined,
): void {
  const { sink, space } = context;
  const direction = arcDirection(context, note);
  const s = direction === 'down' ? 1 : -1;
  const size = TAB.fretSize * space;
  const y = lineY(context, note.string) + s * labelHalfHeight(size);
  drawTie(sink, left, right, y, direction, space, { node: note.id });
  if (letter === undefined || right - left < space * 0.2) return;
  const letterSize = TAB.letterSize * space;
  const { ascent } = textExtent(letterSize);
  const apex = y + s * tieHeight(right - left, space);
  const baseline = s < 0 ? apex - TAB.letterGap * space : apex + TAB.letterGap * space + ascent;
  const x = (left + right) / 2;
  const width = textWidth(letter, letterSize);
  const knockX = TAB.knockoutX * letterSize;
  const knockY = TAB.knockoutY * letterSize;
  sink.primitives.push(
    box(
      rect(
        x - width / 2 - knockX,
        baseline - ascent - knockY,
        width + 2 * knockX,
        ascent + 2 * knockY,
      ),
      0,
      { fill: true, role: 'paper', node: note.id },
    ),
    text(letter, x, baseline, letterSize, { anchor: 'middle', node: note.id }),
  );
}

function drawSlideLine(
  context: TabContext,
  note: Note,
  x0: number,
  x1: number,
  from: number,
  to: number,
): void {
  const { sink, space } = context;
  if (x1 - x0 < space * 0.2) return;
  const y = lineY(context, note.string);
  sink.primitives.push(
    line(x0, y + from * space, x1, y + to * space, SLIDE.thickness * space, { node: note.id }),
  );
}

/** Rises (negative y) towards a higher fret, falls towards a lower one. */
function slideRise(origin: Note, target: Note): number {
  return target.fret > origin.fret ? -SLIDE.rise : SLIDE.rise;
}

function hammerLetter(origin: Note, target: Note): string {
  return target.fret >= origin.fret ? 'H' : 'P';
}

/** Draws a shift or legato slide from `origin` to `target`, whole or as a destination half. */
function drawSlide(
  context: TabContext,
  origin: Origin,
  target: Note,
  targetX: number,
  targetLabel: NoteLabel | undefined,
): void {
  const { placement, space } = context;
  const size = TAB.fretSize * space;
  const rise = slideRise(origin.note, target);
  const end = targetX - leftEdge(targetLabel, size) - SLIDE.gap * space;
  const start = origin.x === undefined ? placement.x : origin.x + origin.edge + SLIDE.gap * space;
  const from = origin.x === undefined ? 0 : -rise;
  drawSlideLine(context, target, start, end, from, rise);
  if (origin.note.slide?.includes('legato')) {
    const arcStart = origin.x === undefined ? placement.x : origin.x + origin.edge;
    drawArc(context, origin.note, arcStart, targetX - leftEdge(targetLabel, size), 'sl.');
  }
}

/** The origin half at a system's end of a slide or hammer-on whose target is in the next bar. */
function drawOriginHalf(
  context: TabContext,
  note: Note,
  label: NoteLabel,
  x: number,
  target: Note,
): void {
  const { space } = context;
  const size = TAB.fretSize * space;
  const left = x + rightEdge(label, size);
  const right = contentEnd(context);
  if (target.hammerPull) drawArc(context, note, left, right, undefined);
  if (shifts(note)) {
    drawSlideLine(context, note, left + SLIDE.gap * space, right, -slideRise(note, target), 0);
    if (note.slide?.includes('legato') && !target.hammerPull) {
      drawArc(context, note, left, right, undefined);
    }
  }
}

function locate(
  context: TabContext,
  voice: TabVoice,
  xs: readonly number[],
  found: { note: Note; bar: number; beat: number },
): Origin {
  const { input, placement, options, space } = context;
  const size = TAB.fretSize * space;
  if (found.bar === input.barIndex) {
    const beat = voice.beats[found.beat];
    const label = beat?.labels.find((candidate) => candidate.note === found.note);
    const x = xs[found.beat];
    return { note: found.note, ...(x !== undefined && { x }), edge: rightEdge(label, size) };
  }
  const edge = rightEdge(labelOf(found.note, size, options), size);
  if (found.bar === input.barIndex - 1 && placement.previous) {
    const beats = voiceBeats(input.track, found.bar, voice.index);
    return { note: found.note, x: placement.previous.onsetX(tickOf(beats, found.beat)), edge };
  }
  return { note: found.note, edge };
}

/** Of a beat's hammer-ons arcing one way, only the outermost string carries the letter. */
function lettered(context: TabContext, beat: TabBeat): Set<Note> {
  const hammered = beat.labels.map(({ note }) => note).filter((note) => note.hammerPull);
  const up = hammered.filter((note) => arcDirection(context, note) === 'up');
  const down = hammered.filter((note) => arcDirection(context, note) === 'down');
  const out = new Set<Note>();
  const top = up.sort((a, b) => a.string - b.string)[0];
  const bottom = down.sort((a, b) => b.string - a.string)[0];
  if (top) out.add(top);
  if (bottom) out.add(bottom);
  return out;
}

/**
 * One frame for all the bends of a beat or grace column, so equal bends in a chord meet at one
 * tip whatever their numbers' widths, and releases to zero end above the topmost bent number.
 */
function drawBendGroup(
  context: TabContext,
  labels: readonly NoteLabel[],
  at: number,
  size: number,
  stop: number,
  min: number,
  drawn: Set<string>,
): void {
  const { placement, sink, space } = context;
  const band = placement.lanes.bend;
  const bent = labels.filter((label) => label.note.bend);
  const [top] = bent;
  if (!band || !top) return;
  const x0 = at + Math.max(...bent.map((label) => rightEdge(label, size))) + BEND.gap * space;
  const xEnd = Math.max(stop, x0 + min * space);
  const releaseTop = lineY(context, top.note.string) - labelHalfHeight(size);
  for (const label of bent) {
    const { bend } = label.note;
    if (!bend) continue;
    const y = lineY(context, label.note.string);
    const frame = {
      x0,
      xEnd,
      yBase: y,
      laneBottom: band.bottom,
      onset: at,
      numberTop: y - labelHalfHeight(size),
      releaseTop,
      tied: label.note.tie,
    };
    drawBend(sink, bend, frame, space, label.note.id, drawn);
  }
}

function drawBends(context: TabContext, beat: TabBeat, x: number, next: number): void {
  const { space } = context;
  const size = TAB.fretSize * space;
  const drawn = new Set<string>();
  drawBendGroup(context, beat.labels, x, size, next - BEND.stop * space, BEND.min, drawn);
  const centres = graceCentres(beat, x, space);
  const graceSize = size * TAB.graceScale;
  for (const [g, column] of beat.graces.entries()) {
    const centre = centres[g];
    if (centre === undefined) continue;
    const following = beat.graces[g + 1];
    const nextCentre = centres[g + 1];
    const nextLeft =
      following && nextCentre !== undefined
        ? nextCentre - following.width / 2
        : x - beat.half - beat.stroke;
    // A grace bend gets no minimum length: it would reach into the number it leads to.
    const stop = nextLeft - BEND.graceStop * space;
    const sorted = [...column.labels].sort((a, b) => a.note.string - b.note.string);
    drawBendGroup(context, sorted, centre, graceSize, stop, 0, drawn);
  }
}

/** Slides into and out of a note from nowhere. */
function drawLooseSlides(context: TabContext, label: NoteLabel, x: number): void {
  const { space } = context;
  const size = TAB.fretSize * space;
  const { note } = label;
  const before = x - leftEdge(label, size) - SLIDE.clear * space;
  const after = x + rightEdge(label, size) + SLIDE.clear * space;
  const length = SLIDE.length * space;
  for (const kind of note.slide ?? []) {
    if (kind === 'intoFromBelow')
      drawSlideLine(context, note, before - length, before, SLIDE.rise, -SLIDE.rise);
    if (kind === 'intoFromAbove')
      drawSlideLine(context, note, before - length, before, -SLIDE.rise, SLIDE.rise);
    if (kind === 'outDown')
      drawSlideLine(context, note, after, after + length, -SLIDE.rise, SLIDE.rise);
    if (kind === 'outUp')
      drawSlideLine(context, note, after, after + length, SLIDE.rise, -SLIDE.rise);
  }
}

/**
 * Bends, slides and hammer-ons of one voice. A connection is drawn by the bar holding its
 * target, in one piece when its origin is in this bar or the previous bar of the system and as a
 * half from the bar's left edge otherwise; a bar ending a system draws the origin half of each
 * connection whose target is in the next bar.
 */
export function drawNoteEffects(context: TabContext, voice: TabVoice, xs: readonly number[]): void {
  const { input, placement, space } = context;
  const { track, barIndex } = input;
  const size = TAB.fretSize * space;
  const graceSize = size * TAB.graceScale;
  const here = connections(track.bars[barIndex]);
  // Most bars connect nothing: finding each note's neighbours on its string is skipped for them.
  const slidesIn = here.shifts || connections(track.bars[barIndex - 1]).shifts;
  const endsLine = !placement.next;
  const leavesLine = endsLine && (here.shifts || connections(track.bars[barIndex + 1]).hammers);
  for (const [i, beat] of voice.beats.entries()) {
    const x = xs[i];
    if (x === undefined || beat.beat.rest) continue;
    if (!beat.connects && !slidesIn && !leavesLine) continue;
    const next = xs[i + 1] ?? contentEnd(context);
    if (beat.connects) drawBends(context, beat, x, next);
    const at: TiePosition = { bar: barIndex, voice: voice.index, beat: beat.index };
    const letters = lettered(context, beat);
    const centres = graceCentres(beat, x, space);
    const lastGrace = beat.graces.at(-1);
    const lastCentre = centres.at(-1);
    for (const label of beat.labels) {
      const { note } = label;
      drawLooseSlides(context, label, x);
      const grace = lastGrace?.labels.find((candidate) => candidate.note.string === note.string);
      if (grace && lastCentre !== undefined) {
        const origin = { note: grace.note, x: lastCentre, edge: rightEdge(grace, graceSize) };
        if (shifts(grace.note)) drawSlide(context, origin, note, x, label);
        if (note.hammerPull) {
          const letter = letters.has(note) ? hammerLetter(grace.note, note) : undefined;
          drawArc(context, note, lastCentre + origin.edge, x - leftEdge(label, size), letter);
        }
      } else if (note.hammerPull || slidesIn) {
        const found = tieOriginOf(track, at, note);
        const near = found && found.bar >= barIndex - TIE_REACH_BARS ? found : undefined;
        if (near && (shifts(near.note) || note.hammerPull)) {
          const origin = locate(context, voice, xs, near);
          if (shifts(near.note) && near.bar >= barIndex - 1)
            drawSlide(context, origin, note, x, label);
          // A legato slide already draws its arc, labelled `sl.`.
          if (note.hammerPull && !near.note.slide?.includes('legato')) {
            const left = origin.x === undefined ? placement.x : origin.x + origin.edge;
            const letter = letters.has(note) ? hammerLetter(near.note, note) : undefined;
            drawArc(context, note, left, x - leftEdge(label, size), letter);
          }
        }
      }
      if (!leavesLine) continue;
      const target = nextOnString(track, at, note);
      if (target && target.bar !== barIndex && (target.note.hammerPull || shifts(note))) {
        drawOriginHalf(context, note, label, x, target.note);
      }
    }
  }
}

/** Arpeggio waves and brush lines left of a beat's numbers, with their arrowheads. */
export function drawStrokes(context: TabContext, voice: TabVoice, xs: readonly number[]): void {
  const { sink, space } = context;
  for (const [i, beat] of voice.beats.entries()) {
    const x = xs[i];
    const stroke = beat.beat.effects.arpeggio ?? beat.beat.effects.brush;
    if (x === undefined || beat.stroke === 0 || !stroke) continue;
    const strings = beat.labels.map(({ note }) => note.string);
    const top = lineY(context, Math.min(...strings)) - STROKE.reach * space;
    const bottom = lineY(context, Math.max(...strings)) + STROKE.reach * space;
    const at = x - beat.half - beat.stroke / 2;
    const node = beat.beat.id;
    const arrow = ARROW_LENGTH * space;
    const towardTop = stroke.direction === 'down';
    const [from, to] = towardTop ? [bottom, top + arrow] : [top, bottom - arrow];
    if (beat.beat.effects.arpeggio) {
      const wave = verticalWave(from, to, at, WAVES.slight, space, { node });
      if (wave) sink.primitives.push(wave);
    } else {
      sink.primitives.push(line(at, from, at, to, STROKE.thickness * space, { node }));
    }
    sink.primitives.push(
      arrowhead(at, towardTop ? top : bottom, towardTop ? 'up' : 'down', space, { node }),
    );
  }
}
