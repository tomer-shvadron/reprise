import { beatTicks, type Id } from '@reprise/model';

import { engraving } from '../../metrics';
import { glyph, glyphWidth, line, rect, union, type LayoutSink } from '../../primitives';
import type { Rect, StaffType } from '../../types';
import { DYNAMICS_GLYPHS, dynamicsBaseline, shownDynamics } from '../dynamics';
import type { StaffBar, StaffBarPlacement } from '../staff-module';
import { headEdges, loneHeadRight, mainHeads, tieDirection, type ChordPlan } from './chord';
import {
  beamedTremoloY,
  drawArticulation,
  drawBends,
  drawConnections,
  drawStrokes,
  drawTremolo,
  type ConnectionContext,
} from './effects';
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
    if (head.ghost && chord.parens) {
      for (const [name, at] of [
        ['noteheadParenthesisLeft', chord.parens.left],
        ['noteheadParenthesisRight', chord.parens.right],
      ] as const) {
        sink.primitives.push(
          glyph(name, x + at, top + head.y, space, { scale, node: head.note.id }),
        );
      }
    }
    box = box ? union(box, drawn.bbox) : drawn.bbox;
    if (head.sounding) continue;
    // A harmonic's diamond is taller than a staff space; its anchor keeps to one, as other heads'
    // do, so diamonds a third apart do not overlap. Percussion diamonds keep their glyph's box.
    const diamond = head.glyph.startsWith('noteheadDiamond') && head.note.harmonic !== undefined;
    const { x: bx, width: bw } = drawn.bbox;
    const by = diamond ? top + head.y - (space * scale) / 2 : drawn.bbox.y;
    const bh = diamond ? space * scale : drawn.bbox.height;
    let bbox =
      head.shared > 0
        ? rect(bx + head.shared, by, bw - head.shared, bh)
        : rect(bx, by, bw + head.shared, bh);
    // One x splits a head two voices share, so the halves meet whatever their glyphs' widths.
    if (head.half) {
      const at = x + head.half.at;
      bbox =
        head.half.side === 'left'
          ? rect(bbox.x, by, at - bbox.x, bh)
          : rect(at, by, bbox.x + bbox.width - at, bh);
    }
    sink.anchors.push({ kind: 'note', id: head.note.id, bbox, ...anchorBase(context, voice) });
  }
  return box;
}

/** The x a beat is drawn at: its onset, or the bar's middle for a rest alone in its voice. */
function beatX(context: Context, beat: BeatPlan): number {
  const { placement } = context;
  if (beat.rest?.centred) return placement.x + placement.width / 2;
  return placement.onsetX(beat.tick) + (beat.shift ?? 0);
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
    const beam = beamLine(stems, group.direction, {
      space,
      middle: top + 2 * space,
      exact: true,
      extend: group.extend,
    });
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

  // The outer edge of each beat's articulation, for the tuplet beyond it.
  const marked = new Map<BeatPlan, number>();
  for (const beat of plan.beats) {
    const { chord } = beat;
    if (!chord) continue;
    const x = beatX(context, beat);
    const id = beat.beat.id;
    const { tremolo, articulation } = beat;
    if (tremolo) {
      const tip = tips.get(beat);
      const y =
        tremolo.y ??
        (tip === undefined ? undefined : beamedTremoloY(tremolo, chord, tip - top, space));
      const stemX = chord.stem ? chord.stem.x : 0;
      if (y !== undefined) drawTremolo(sink, tremolo.glyph, x + stemX, top + y, space, id);
    }
    if (articulation) {
      const tip = tips.get(beat);
      const edge =
        articulation.stemSide && chord.stem && tip !== undefined ? tip - top : articulation.edge;
      marked.set(beat, drawArticulation(sink, articulation, x, top, edge, space, id));
    }
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
      const mark = marked.get(beat);
      if (mark !== undefined && beat.articulation?.above === tuplet.above) extremes.push(mark);
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

  if (type === 'standard') {
    const connecting: ConnectionContext = {
      input,
      placement,
      plan,
      sink,
      space,
      beatX: (beat) => beatX(context, beat),
    };
    for (const [voice, beats] of plan.voices.entries()) drawConnections(connecting, voice, beats);
    drawStrokes(connecting);
    if (input.staves.length === 1) {
      for (const beats of plan.voices) drawBends(connecting, beats);
    }
  }

  const shown = shownDynamics(input.track, input.barIndex);
  const lane = placement.lanes.dynamics;
  for (const beat of plan.beats) {
    const x = beatX(context, beat);
    const dynamics = shown.get(beat.beat.id);
    if (dynamics && lane) {
      const name = DYNAMICS_GLYPHS[dynamics];
      sink.primitives.push(
        glyph(name, x - glyphWidth(name, space) / 2, dynamicsBaseline(lane.top, space), space, {
          node: beat.beat.id,
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
  const blackWidth = glyphWidth('noteheadBlack', space);
  const previousBar = input.barIndex > 0 ? input.track.bars[input.barIndex - 1] : undefined;
  const nextBar = input.track.bars[input.barIndex + 1];

  for (const [voice, beats] of plan.voices.entries()) {
    for (const beat of beats) {
      const { chord } = beat;
      if (!chord) continue;
      const x = beatX(context, beat);
      for (const head of mainHeads(chord)) {
        if (!head.note.tie) continue;
        const direction = tieDirection(chord, head, plan.multiVoice);
        const end = x + headEdges(chord, head).left - gap;
        let start: number | undefined;
        const before = beats[beat.index - 1];
        if (before) {
          const sourceChord = before.chord;
          const source =
            sourceChord &&
            mainHeads(sourceChord).find((other) => noteMatches(other.note, head.note, fretted));
          if (sourceChord && source)
            start = beatX(context, before) + headEdges(sourceChord, source).right + gap;
        } else if (previousBar) {
          const voiceBeats = previousBar.voices[voice]?.beats ?? [];
          const last = voiceBeats.at(-1);
          const source = last?.notes.find((note) => noteMatches(note, head.note, fretted));
          if (last && source) {
            if (placement.previous) {
              let tick = 0;
              for (const b of voiceBeats.slice(0, -1)) tick += beatTicks(b);
              const reach = loneHeadRight(blackWidth, source.ghost, last.dots, space);
              start = placement.previous.onsetX(tick) + reach + gap;
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
    for (const head of mainHeads(last.chord)) {
      if (!following.notes.some((note) => note.tie && noteMatches(note, head.note, fretted)))
        continue;
      const direction = tieDirection(last.chord, head, plan.multiVoice);
      drawTie(
        sink,
        x + headEdges(last.chord, head).right + gap,
        placement.x + placement.width,
        top + head.y,
        direction,
        space,
        head.note.id,
      );
    }
  }
}
