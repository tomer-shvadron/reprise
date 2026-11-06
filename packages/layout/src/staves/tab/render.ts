import {
  TIE_REACH_BARS,
  beatTicks,
  tieOriginOf,
  type Beat,
  type Note,
  type TieLink,
  type TiePosition,
  type Track,
} from '@reprise/model';

import { glyphMetrics, textExtent } from '../../metrics';
import { box, glyph, rect, text, type LayoutSink } from '../../primitives';
import type { Anchor, Rect } from '../../types';
import {
  BEAM_PITCH,
  beamCount,
  drawBeams,
  drawDots,
  drawFlag,
  drawStem,
  drawTie,
  drawTuplet,
  type StemDirection,
} from '../rhythm';
import type { StaffBar, StaffBarPlacement } from '../staff-module';
import { DYNAMICS_GLYPHS, dynamicsBaseline, shownDynamics } from '../dynamics';
import { analyseEffects, drawLanes } from '../effects';
import {
  TAB,
  analyseBar,
  fingering,
  labelHalf,
  labelHalfHeight,
  freeStem,
  labelOf,
  restGlyph,
  tremoloGlyph,
  type NoteLabel,
  type TabBeat,
  type TabOptions,
  type TabVoice,
} from './analysis';
import { lineY, type TabContext as Context } from './context';
import { drawNoteEffects, drawStrokes, graceCentres } from './effects';
import { wordStart } from './measure';

const sign = (direction: StemDirection): number => (direction === 'down' ? 1 : -1);
/** A tuplet of one beat still gets a bracket this wide either side of it, in staff spaces. */
const TUPLET_OVERHANG = 0.4;
/** Room under a row's baseline for descenders, in staff spaces. */
const DESCENT = 0.6;
/** A word row's baseline above the row's bottom: descenders and a gap from what is below. */
const WORD_LIFT = 0.8;

/** Where a voice's stems start, next to the outer string, and where unbeamed ones end. */
function stemBase(context: Context, direction: StemDirection): number {
  const { placement, space } = context;
  return direction === 'down'
    ? placement.bottom + TAB.stemGap * space
    : placement.top - TAB.stemGap * space;
}

function anchor(
  context: Context,
  kind: Anchor['kind'],
  id: string,
  bbox: Rect,
  voice: number,
): void {
  const { input, placement, sink } = context;
  sink.anchors.push({
    kind,
    id,
    bbox,
    system: placement.system,
    track: input.track.id,
    staff: 'tab',
    voice,
    masterBar: input.masterBar.id,
  });
}

/** A fret number on its string over a paper knockout, and its note anchor. */
function drawLabel(
  context: Context,
  label: NoteLabel,
  x: number,
  size: number,
  voice: number,
): void {
  const { sink } = context;
  const y = lineY(context, label.note.string);
  const half = labelHalf(label, size);
  const halfHeight = labelHalfHeight(size);
  const area = rect(x - half, y - halfHeight, half * 2, halfHeight * 2);
  if (label.text !== undefined) {
    sink.primitives.push(
      box(area, 0, { fill: true, role: 'paper', node: label.note.id }),
      text(label.text, x, y + textExtent(size).ascent / 2, size, {
        anchor: 'middle',
        node: label.note.id,
      }),
    );
  }
  if (label.suffix) {
    const small = size * TAB.graceScale;
    const knockX = TAB.knockoutX * small;
    const left = x + half + TAB.suffixGap * size;
    const smallHalfHeight = labelHalfHeight(small);
    sink.primitives.push(
      box(
        rect(left, y - smallHalfHeight, label.suffix.width + 2 * knockX, smallHalfHeight * 2),
        0,
        { fill: true, role: 'paper', node: label.note.id },
      ),
      text(label.suffix.text, left + knockX, y + textExtent(small).ascent / 2, small, {
        node: label.note.id,
      }),
    );
  }
  anchor(context, 'note', label.note.id, area, voice);
}

function drawGraces(context: Context, beat: TabBeat, x: number): void {
  const { space, sink } = context;
  const size = TAB.fretSize * space * TAB.graceScale;
  const base = stemBase(context, beat.direction);
  const centres = graceCentres(beat, x, space);
  // Nearest the beat first, as the columns were always drawn.
  for (const [g, column] of [...beat.graces.entries()].reverse()) {
    const centre = centres[g] ?? x;
    for (const label of column.labels) drawLabel(context, label, centre, size, beat.voice);
    if (context.analysed.rhythm) {
      const end = base + sign(beat.direction) * TAB.graceStem * space;
      const node = beat.beat.id;
      drawStem(sink, centre, base, end, space, { scale: TAB.graceScale, node });
      drawFlag(sink, column.duration, centre, end, beat.direction, space, {
        scale: TAB.graceScale * 0.85,
        node,
      });
    }
  }
}

function restCentre(context: Context, direction: StemDirection): number {
  const { placement, space } = context;
  return direction === 'down'
    ? (placement.top + placement.bottom) / 2
    : placement.top - (TAB.stemGap + TAB.stem / 2) * space;
}

function drawRest(context: Context, beat: TabBeat, x: number): void {
  const { sink, space } = context;
  const name = restGlyph(beat.beat.duration);
  const { bbox, advance } = glyphMetrics(name);
  const centre = restCentre(context, beat.direction);
  sink.primitives.push(
    glyph(name, x - (advance * space) / 2, centre + ((bbox.top + bbox.bottom) / 2) * space, space, {
      node: beat.beat.id,
    }),
  );
  drawDots(
    sink,
    beat.beat.dots,
    x + beat.half + TAB.restSpacing * space,
    centre - space / 2,
    space,
    {
      node: beat.beat.id,
    },
  );
}

/** Stems, flags, beams, dots and tuplets of one voice. */
function drawRhythm(context: Context, voice: TabVoice, xs: readonly number[]): void {
  const { sink, space } = context;
  const { direction } = voice;
  const s = sign(direction);
  const base = stemBase(context, direction);
  const stemEnd = (beams: number): number =>
    base + s * (TAB.stem * space + voice.tremolo + Math.max(0, beams - 2) * BEAM_PITCH * space);

  for (const indices of voice.beams) {
    const beats = indices.flatMap((i) => {
      const beat = voice.beats[i];
      const x = xs[i];
      return beat && x !== undefined ? [{ beat, x, beams: beamCount(beat.beat.duration) }] : [];
    });
    const end = stemEnd(Math.max(...beats.map(({ beams }) => beams)));
    for (const { beat, x } of beats) drawStem(sink, x, base, end, space, { node: beat.beat.id });
    const [only] = beats;
    if (beats.length === 1 && only) {
      drawFlag(sink, only.beat.beat.duration, only.x, end, direction, space, {
        node: only.beat.beat.id,
      });
    } else {
      drawBeams(
        sink,
        beats.map(({ x, beams }) => ({ x, beams })),
        end,
        direction,
        space,
        only && { node: only.beat.beat.id },
      );
    }
  }

  for (const [i, beat] of voice.beats.entries()) {
    const x = xs[i];
    if (x === undefined || beat.event.silent) continue;
    const { duration, dots, id } = beat.beat;
    const from = duration === 2 ? base + s * TAB.halfStemSkip * space : base;
    if (duration === 2 || duration === 4) drawStem(sink, x, from, stemEnd(0), space, { node: id });
    drawDots(sink, dots, x + TAB.dotX * space, from + s * TAB.dotY * space, space, { node: id });
    const tremolo = tremoloGlyph(beat.beat);
    if (tremolo) {
      const free = freeStem(beat.beat);
      const middle = base + s * ((free.from + free.to) / 2) * space + (s * voice.tremolo) / 2;
      const { bbox } = glyphMetrics(tremolo);
      sink.primitives.push(
        glyph(tremolo, x, middle + ((bbox.top + bbox.bottom) / 2) * space, space, { node: id }),
      );
    }
  }

  const tupletY = base + s * (TAB.stem * space + voice.extraStem + TAB.tupletGap * space);
  for (const group of voice.tuplets) {
    const left = xs[group.start];
    const right = xs[group.end];
    const first = voice.beats[group.start];
    if (left === undefined || right === undefined || !first) continue;
    const beamed = voice.beams.some(
      (indices) => indices[0] === group.start && indices.at(-1) === group.end,
    );
    const overhang = (left === right ? TUPLET_OVERHANG * 2 : TUPLET_OVERHANG) * space;
    drawTuplet(sink, group.n, left - overhang, right + overhang, tupletY, direction, space, {
      bracket: !beamed,
      node: first.beat.id,
    });
  }
}

/** The tie's y: just past the fret number, on the side the voice's stems go. */
function tieY(context: Context, note: Note, direction: StemDirection): number {
  const size = TAB.fretSize * context.space;
  return lineY(context, note.string) + sign(direction) * labelHalfHeight(size);
}

function labelEdge(label: NoteLabel | undefined, size: number): number {
  return label?.text === undefined ? 0 : labelHalf(label, size);
}

function trackVoiceBeats(track: Track, barIndex: number, voice: number) {
  return track.bars[barIndex]?.voices[voice]?.beats ?? [];
}

function tickOf(beats: readonly Beat[], index: number): number {
  let tick = 0;
  for (const beat of beats.slice(0, index)) tick += beatTicks(beat);
  return tick;
}

/**
 * The note that continues `note` by a tie, the inverse of `tieOriginOf`: the next note on the
 * string within the tie's reach, when it is tied on the same fret back to this one.
 */
function continuedBy(track: Track, at: TiePosition, note: Note): TieLink | undefined {
  for (let bar = at.bar; bar <= at.bar + TIE_REACH_BARS && bar < track.bars.length; bar++) {
    const beats = trackVoiceBeats(track, bar, at.voice);
    for (let i = bar === at.bar ? at.beat + 1 : 0; i < beats.length; i++) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const next = beat.notes.find((candidate) => candidate.string === note.string);
      if (!next) continue;
      if (!next.tie || next.fret !== note.fret) return undefined;
      const origin = tieOriginOf(track, { bar, voice: at.voice, beat: i }, next);
      return origin?.note === note ? { note: next, bar, beat: i } : undefined;
    }
  }
  return undefined;
}

/**
 * Every tie is drawn by the bar holding its target note, from the origin `tieOriginOf` finds: in
 * one piece when the origin is in this bar or in the previous bar of the system, otherwise as a
 * half from the bar's left edge. A bar ending a system draws the other half, to its right edge,
 * for each of its notes a later bar continues.
 */
function drawTies(context: Context, voice: TabVoice, xs: readonly number[]): void {
  const { input, placement, sink, options, space } = context;
  const { track, barIndex } = input;
  const size = TAB.fretSize * space;
  const at = (beat: number): TiePosition => ({ bar: barIndex, voice: voice.index, beat });
  for (const [i, beat] of voice.beats.entries()) {
    const x = xs[i];
    if (x === undefined) continue;
    for (const label of beat.labels) {
      const { note } = label;
      const y = tieY(context, note, beat.direction);
      const origin = note.tie ? tieOriginOf(track, at(beat.index), note) : undefined;
      if (origin) {
        const right = x - labelEdge(label, size);
        const drawn = { node: note.id };
        if (origin.bar === barIndex) {
          const from = voice.beats[origin.beat];
          const fromX = xs[origin.beat];
          if (from && fromX !== undefined) {
            const edge = labelEdge(
              from.labels.find((other) => other.note === origin.note),
              size,
            );
            drawTie(sink, fromX + edge, right, y, beat.direction, space, drawn);
          }
        } else if (origin.bar === barIndex - 1 && placement.previous) {
          const beats = trackVoiceBeats(track, origin.bar, voice.index);
          const fromX = placement.previous.onsetX(tickOf(beats, origin.beat));
          const edge = labelEdge(labelOf(origin.note, size, options), size);
          drawTie(sink, fromX + edge, right, y, beat.direction, space, drawn);
        } else {
          drawTie(sink, placement.x, right, y, beat.direction, space, drawn);
        }
      }
      if (placement.next) continue;
      const next = continuedBy(track, at(beat.index), note);
      if (next && next.bar !== barIndex) {
        const left = x + labelEdge(label, size);
        drawTie(sink, left, placement.x + placement.width, y, beat.direction, space, {
          node: next.note.id,
        });
      }
    }
  }
}

function drawWords(context: Context, xs: Map<TabBeat, number>): void {
  const { input, placement, sink, analysed, space } = context;
  const { lanes } = placement;
  const size = TAB.textSize * space;
  const fingerSize = TAB.fingerSize * space;
  const shown = analysed.rhythm ? shownDynamics(input.track, input.barIndex) : undefined;

  for (const beat of analysed.beats) {
    const x = xs.get(beat);
    if (x === undefined) continue;
    const node = beat.beat.id;
    const { chord, lyrics } = beat.beat;
    if (chord && lanes.chord) {
      const y = lanes.chord.bottom - WORD_LIFT * space;
      sink.primitives.push(text(chord.name, x + wordStart(beat), y, size, { node }));
    }
    if (beat.beat.text && lanes.text) {
      const y = lanes.text.bottom - WORD_LIFT * space;
      sink.primitives.push(text(beat.beat.text, x + wordStart(beat), y, size, { node }));
    }
    const fingered = analysed.rhythm
      ? beat.labels.flatMap(({ note }) => {
          const label = fingering(note);
          return label === undefined ? [] : [{ note, label }];
        })
      : [];
    for (const [j, { note, label }] of fingered.entries()) {
      if (!lanes.fingering) break;
      const k = fingered.length - 1 - j;
      const y = lanes.fingering.bottom - k * TAB.fingerRow * space - 0.25 * space;
      sink.primitives.push(text(label, x, y, fingerSize, { anchor: 'middle', node: note.id }));
    }
    for (const [line, syllable] of (lyrics ?? []).entries()) {
      if (syllable === '' || !lanes.lyrics) continue;
      const y = lanes.lyrics.top + (line + 1) * TAB.lyricRow * space - DESCENT * space;
      sink.primitives.push(text(syllable, x, y, size, { anchor: 'middle', node }));
    }
    const dynamics = shown?.get(node);
    if (dynamics && lanes.dynamics) {
      const name = DYNAMICS_GLYPHS[dynamics];
      const unit = TAB.dynamicsScale * space;
      const y = dynamicsBaseline(lanes.dynamics.top, unit);
      sink.primitives.push(
        glyph(name, x - (glyphMetrics(name).advance * unit) / 2, y, space, {
          scale: TAB.dynamicsScale,
          node,
        }),
      );
    }
  }
}

export function renderTab(
  input: StaffBar,
  placement: StaffBarPlacement,
  sink: LayoutSink,
  options: TabOptions,
): void {
  const { space } = input;
  const analysed = analyseBar(input, options);
  const context: Context = { input, placement, sink, options, analysed, space };
  const size = TAB.fretSize * space;
  const positions = new Map<TabBeat, number>();
  const reach = TAB.beatReach * space;

  for (const voice of analysed.voices) {
    // A rest alone in its voice is centred in the bar, as Guitar Pro draws a whole-bar rest.
    const [only] = voice.beats;
    const alone = voice.beats.length === 1 && only !== undefined && only.beat.rest;
    const xs = voice.beats.map((beat) =>
      alone ? placement.x + placement.width / 2 : placement.onsetX(beat.tick),
    );
    for (const [i, beat] of voice.beats.entries()) {
      const x = xs[i];
      if (x === undefined) continue;
      positions.set(beat, x);
      if (beat.beat.rest && analysed.rhythm) drawRest(context, beat, x);
      for (const label of beat.labels) drawLabel(context, label, x, size, beat.voice);
      drawGraces(context, beat, x);
      const upper = beat.direction === 'up';
      const top = placement.top - (upper && analysed.rhythm ? analysed.rows.upper : reach);
      const bottom = placement.bottom + (upper || !analysed.rhythm ? reach : analysed.rows.lower);
      anchor(
        context,
        'beat',
        beat.beat.id,
        rect(x - beat.left, top, beat.left + beat.right, bottom - top),
        beat.voice,
      );
    }
    if (analysed.rhythm) drawRhythm(context, voice, xs);
    drawTies(context, voice, xs);
    drawStrokes(context, voice, xs);
    drawNoteEffects(context, voice, xs);
  }
  drawWords(context, positions);
  drawLanes({
    input,
    placement,
    sink,
    space,
    effects: analyseEffects(input.bar, space, { articulations: analysed.rhythm }),
  });
}
