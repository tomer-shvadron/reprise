import { beatTicks, type Id } from '@reprise/model';

import { engraving } from '../../metrics';
import { glyph, glyphWidth, line, rect, union, type LayoutSink } from '../../primitives';
import type { Rect, StaffType } from '../../types';
import { DYNAMICS_GLYPHS } from '../dynamics';
import type { StaffBar, StaffBarPlacement } from '../staff-module';
import type { ChordPlan } from './chord';
import { GRACE_SCALE, noteMatches, type BarPlan, type BeatPlan } from './plan';
import {
  beamY,
  beamLine,
  drawBeams,
  drawDots,
  drawFlag,
  drawStem,
  drawTie,
  drawTuplet,
  type ArcDirection,
  type BeamStem,
} from './rhythm';

const TIE_GAP = 0.15;
const FINGERING_STEP = 1.1;

interface Context {
  input: StaffBar;
  placement: StaffBarPlacement;
  plan: BarPlan;
  sink: LayoutSink;
  type: StaffType;
  space: number;
}

function anchorBase(context: Context, voice: number) {
  return {
    system: context.placement.system,
    track: context.input.track.id,
    staff: context.type,
    voice,
    masterBar: context.input.masterBar.id,
  };
}

/** Ledger lines, heads, accidentals and dots of a chord at `x`; the heads' boxes as note anchors. */
function drawChord(
  context: Context,
  chord: ChordPlan,
  x: number,
  voice: number,
  beat: Id,
): Rect | undefined {
  const { sink, space, placement } = context;
  const top = placement.top;
  const { scale } = chord;
  const ledger = engraving.legerLineThickness * space * scale;
  for (const { y, left, right } of chord.ledgers) {
    sink.primitives.push(line(x + left, top + y, x + right, top + y, ledger, { node: beat }));
  }
  let box: Rect | undefined;
  for (const head of chord.heads) {
    if (head.accidental) {
      let cursor = x + head.accidental.left;
      for (const name of head.accidental.glyphs) {
        sink.primitives.push(
          glyph(name, cursor, top + head.y, space, { scale, node: head.note.id }),
        );
        cursor += glyphWidth(name, space, scale);
      }
    }
    const drawn = glyph(head.glyph, x + head.left, top + head.y, space, {
      scale,
      node: head.note.id,
    });
    sink.primitives.push(drawn);
    const { x: bx, y: by, width: bw, height: bh } = drawn.bbox;
    const bbox =
      head.shared > 0
        ? rect(bx + head.shared, by, bw - head.shared, bh)
        : rect(bx, by, bw + head.shared, bh);
    sink.anchors.push({ kind: 'note', id: head.note.id, bbox, ...anchorBase(context, voice) });
    box = box ? union(box, drawn.bbox) : drawn.bbox;
  }
  return box;
}

/** The x a beat is drawn at: its onset, or the bar's middle for a rest alone in its voice. */
function beatX(context: Context, beat: BeatPlan): number {
  const { placement } = context;
  if (beat.rest?.centred) return placement.x + placement.width / 2;
  return placement.onsetX(beat.tick);
}

function tieDirection(chord: ChordPlan, index: number, multiVoice: boolean): ArcDirection {
  const up = chord.direction === 'up';
  if (multiVoice) return up ? 'up' : 'down';
  const count = chord.heads.length;
  if (count === 1 || (count % 2 === 1 && index === (count - 1) / 2)) return up ? 'down' : 'up';
  return index >= count / 2 ? 'up' : 'down';
}

function drawGraces(context: Context, beat: BeatPlan, x: number): void {
  const { sink, space, placement } = context;
  const stems: BeamStem[] = [];
  for (const grace of beat.graces) {
    const gx = x + grace.offset;
    const { chord } = grace;
    drawChord(context, chord, gx, beat.voice, beat.beat.id);
    if (!chord.stem) continue;
    const stemX = gx + chord.stem.x;
    if (!beat.graceBeam) {
      drawStem(
        sink,
        stemX,
        placement.top + chord.stem.from,
        placement.top + chord.tip,
        space,
        GRACE_SCALE,
        beat.beat.id,
      );
      drawFlag(sink, chord.beams, 'up', stemX, placement.top + chord.tip, space, {
        scale: GRACE_SCALE,
        slash: grace.slash,
        node: beat.beat.id,
      });
    }
    stems.push({ x: stemX, head: placement.top + chord.stem.head, beams: chord.beams });
  }
  if (!beat.graceBeam || stems.length < 2) return;
  const beam = beamLine(stems, 'up', { space, scale: GRACE_SCALE, exact: true });
  for (const [i, grace] of beat.graces.entries()) {
    const stem = stems[i];
    if (!stem || !grace.chord.stem) continue;
    drawStem(
      sink,
      stem.x,
      placement.top + grace.chord.stem.from,
      beamY(stems, beam, stem.x),
      space,
      GRACE_SCALE,
      beat.beat.id,
    );
  }
  drawBeams(sink, stems, 'up', beam, space, { scale: GRACE_SCALE, node: beat.beat.id });
}

/** Draws a bar laid out by `planBar` into the placement the engine gave it. */
export function renderBar(
  input: StaffBar,
  placement: StaffBarPlacement,
  sink: LayoutSink,
  plan: BarPlan,
  type: StaffType,
): void {
  const { space } = input;
  const top = placement.top;
  const context: Context = { input, placement, plan, sink, type, space };
  const tips = new Map<BeatPlan, number>();
  const fretted = input.track.kind === 'fretted';

  for (const beat of plan.beats) {
    const x = beatX(context, beat);
    const id = beat.beat.id;
    let box: Rect | undefined;
    if (beat.rest) {
      const { rest } = beat;
      const drawn = glyph(rest.glyph, x + rest.left, top + rest.y, space, { node: id });
      sink.primitives.push(drawn);
      box = drawn.bbox;
      if (beat.beat.dots > 0)
        drawDots(sink, beat.beat.dots, x + rest.dots.x, [top + rest.dots.y], space, { node: id });
    }
    const { chord } = beat;
    if (chord) {
      drawGraces(context, beat, x);
      box = drawChord(context, chord, x, beat.voice, id);
      if (beat.beat.dots > 0) {
        drawDots(
          sink,
          beat.beat.dots,
          x + chord.dots.x,
          chord.dots.ys.map((y) => top + y),
          space,
          { node: id },
        );
      }
      if (chord.stem && beat.group === undefined) {
        const stemX = x + chord.stem.x;
        drawStem(sink, stemX, top + chord.stem.from, top + chord.tip, space, 1, id);
        drawFlag(sink, chord.beams, chord.direction, stemX, top + chord.tip, space, { node: id });
        tips.set(beat, top + chord.tip);
      }
    }
    const fallback = rect(x - space / 2, top, space, placement.bottom - top);
    const area = box ?? fallback;
    const upper = Math.min(area.y, top - space);
    const lower = Math.max(area.y + area.height, placement.bottom + space);
    sink.anchors.push({
      kind: 'beat',
      id,
      bbox: rect(area.x, upper, area.width, lower - upper),
      ...anchorBase(context, beat.voice),
    });
  }

  for (const group of plan.groups) {
    const stems: BeamStem[] = [];
    for (const beat of group.beats) {
      const { chord } = beat;
      if (!chord?.stem) continue;
      stems.push({
        x: beatX(context, beat) + chord.stem.x,
        head: top + chord.stem.head,
        beams: chord.beams,
      });
    }
    const first = group.beats[0];
    if (!first || stems.length === 0) continue;
    const beam = beamLine(stems, group.direction, { space, middle: top + 2 * space, exact: true });
    let i = 0;
    for (const beat of group.beats) {
      const stem = stems[i];
      if (!beat.chord?.stem || !stem) continue;
      i += 1;
      const tip = beamY(stems, beam, stem.x);
      drawStem(sink, stem.x, top + beat.chord.stem.from, tip, space, 1, beat.beat.id);
      tips.set(beat, tip);
    }
    drawBeams(sink, stems, group.direction, beam, space, { node: first.beat.id });
  }

  for (const tuplet of plan.tuplets) {
    const first = tuplet.beats[0];
    if (!first) continue;
    let left = Infinity;
    let right = -Infinity;
    let edge = tuplet.above ? Infinity : -Infinity;
    for (const beat of tuplet.beats) {
      const x = beatX(context, beat);
      const heads = beat.chord?.heads ?? [];
      const headsLeft =
        heads.length > 0
          ? Math.min(...heads.map((head) => head.left))
          : (beat.rest?.left ?? -space / 2);
      const headsRight =
        heads.length > 0
          ? Math.max(...heads.map((head) => head.left + head.width))
          : (beat.rest?.left ?? -space / 2) + (beat.rest?.width ?? space);
      left = Math.min(left, x + headsLeft);
      right = Math.max(right, x + headsRight);
      const tip = tips.get(beat);
      const extremes = [
        ...heads.map((head) => top + head.y + (tuplet.above ? -space / 2 : space / 2)),
        ...(tip === undefined ? [] : [tip]),
      ];
      if (beat.rest) extremes.push(top + (tuplet.above ? beat.top : beat.bottom));
      if (extremes.length === 0) extremes.push(top + 2 * space);
      edge = tuplet.above ? Math.min(edge, ...extremes) : Math.max(edge, ...extremes);
    }
    drawTuplet(
      sink,
      { n: tuplet.n, left, right, edge, above: tuplet.above, bracket: tuplet.bracket },
      space,
      first.beat.id,
    );
  }

  drawTies(context, fretted);

  for (const beat of plan.beats) {
    const x = beatX(context, beat);
    if (beat.dynamics) {
      const name = DYNAMICS_GLYPHS[beat.dynamics.value];
      sink.primitives.push(
        glyph(name, x - glyphWidth(name, space) / 2, top + plan.dynamicsY, space, {
          node: beat.dynamics.note.id,
        }),
      );
    }
    for (const [i, { glyph: name, note }] of [...beat.fingering].reverse().entries()) {
      const width = glyphWidth(name, space);
      const y = top + plan.fingeringY - i * FINGERING_STEP * space;
      sink.primitives.push(glyph(name, x - width / 2, y, space, { node: note.id }));
    }
  }
}

function drawTies(context: Context, fretted: boolean): void {
  const { input, placement, plan, sink, space } = context;
  const top = placement.top;
  const gap = TIE_GAP * space;
  const blackHalf = glyphWidth('noteheadBlack', space) / 2;
  const previousBar = input.barIndex > 0 ? input.track.bars[input.barIndex - 1] : undefined;
  const nextBar = input.track.bars[input.barIndex + 1];

  for (const [voice, beats] of plan.voices.entries()) {
    for (const beat of beats) {
      const { chord } = beat;
      if (!chord) continue;
      const x = beatX(context, beat);
      for (const [i, head] of chord.heads.entries()) {
        if (!head.note.tie) continue;
        const direction = tieDirection(chord, i, plan.multiVoice);
        const end = x + head.left - gap;
        let start: number | undefined;
        const before = beats[beat.index - 1];
        if (before) {
          const source = before.chord?.heads.find((other) =>
            noteMatches(other.note, head.note, fretted),
          );
          if (source) start = beatX(context, before) + source.left + source.width + gap;
        } else if (previousBar) {
          const voiceBeats = previousBar.voices[voice]?.beats ?? [];
          const last = voiceBeats.at(-1);
          if (last?.notes.some((note) => noteMatches(note, head.note, fretted))) {
            if (placement.previous) {
              let tick = 0;
              for (const b of voiceBeats.slice(0, -1)) tick += beatTicks(b);
              start = placement.previous.onsetX(tick) + blackHalf + gap;
            } else {
              start = placement.x - space;
            }
          }
        }
        if (start !== undefined)
          drawTie(sink, start, end, top + head.y, direction, space, head.note.id);
      }
    }

    const last = beats.at(-1);
    const following = nextBar?.voices[voice]?.beats[0];
    if (placement.next || !last?.chord || !following) continue;
    const x = beatX(context, last);
    for (const [i, head] of last.chord.heads.entries()) {
      if (!following.notes.some((note) => note.tie && noteMatches(note, head.note, fretted)))
        continue;
      const direction = tieDirection(last.chord, i, plan.multiVoice);
      drawTie(
        sink,
        x + head.left + head.width + gap,
        placement.x + placement.width,
        top + head.y,
        direction,
        space,
        head.note.id,
      );
    }
  }
}
