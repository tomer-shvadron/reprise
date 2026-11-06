import { glyphMetrics, textExtent } from '../../metrics';
import { glyph, line, polyline, text, type LayoutSink } from '../../primitives';
import type { LaneBand } from '../lanes';
import type { StaffBar, StaffBarPlacement } from '../staff-module';
import {
  EFFECT_TEXT,
  WHAMMY_TEXT,
  barRuns,
  runLabel,
  sameRun,
  type BarEffects,
  type LaneItem,
  type Run,
} from './analysis';
import { bendLabel } from './labels';
import { SAWTOOTH, WAVES, horizontalWave, sawtooth } from './shapes';

const TICK_EPSILON = 1e-6;
/** A lane text's baseline above the lane's bottom, and a glyph's bottom edge, in staff spaces. */
const TEXT_LIFT = 0.35;
const GLYPH_LIFT = 0.25;
const STACK_GAP = 0.25;
/** From a label to its line, and where a wave stops short of the next onset, in staff spaces. */
const LABEL_GAP = 0.3;
const WAVE_STOP = 0.2;
const TRILL_GAP = 0.1;
const DASH = [0.6, 0.4] as const;
const RUN_LINE = 0.16;
const END_TICK = 0.8;
/** The shortest dashed line worth drawing after a label, in staff spaces. */
const MIN_LINE = 0.3;
/** The whammy lane: its text row, the graph's middle, its scale and its labels, in staff spaces. */
const WHAMMY = {
  baseline: 0.85,
  middle: 2.6,
  step: 0.25,
  limit: 4,
  label: 0.8,
  stop: 0.3,
  gap: 0.2,
};

export interface LaneDraw {
  input: StaffBar;
  placement: StaffBarPlacement;
  sink: LayoutSink;
  space: number;
  effects: BarEffects;
}

function contentEnd(placement: StaffBarPlacement): number {
  return placement.x + placement.width;
}

function continuesFrom(context: LaneDraw, run: Run): boolean {
  if (run.start > TICK_EPSILON) return false;
  const before = context.input.track.bars[context.input.barIndex - 1];
  if (!before) return false;
  const { runs, end } = barRuns(before);
  return runs.some((other) => sameRun(other, run) && other.end >= end - TICK_EPSILON);
}

function continuesOn(context: LaneDraw, run: Run): boolean {
  if (run.end < context.effects.end - TICK_EPSILON) return false;
  const after = context.input.track.bars[context.input.barIndex + 1];
  if (!after) return false;
  return barRuns(after).runs.some((other) => sameRun(other, run) && other.start <= TICK_EPSILON);
}

/** Where a run that carries on into the next bar stops in this one: at the next bar's content. */
function carriedEnd(placement: StaffBarPlacement): number {
  return placement.next ? placement.next.x : contentEnd(placement);
}

function drawItem(context: LaneDraw, item: LaneItem, band: LaneBand): void {
  const { placement, sink, space } = context;
  const x = placement.onsetX(item.tick);
  const node = item.beat.id;
  if (item.text !== undefined) {
    const y = band.bottom - TEXT_LIFT * space;
    sink.primitives.push(text(item.text, x, y, EFFECT_TEXT * space, { anchor: 'middle', node }));
    return;
  }
  let bottom = band.bottom - GLYPH_LIFT * space;
  for (const name of item.glyphs) {
    const { bbox } = glyphMetrics(name);
    const left = x - ((bbox.left + bbox.right) / 2) * space;
    sink.primitives.push(glyph(name, left, bottom + bbox.bottom * space, space, { node }));
    bottom -= (bbox.top - bbox.bottom + STACK_GAP) * space;
  }
}

/** A run labelled with text, then a dashed line to its last onset and an end tick. */
function drawDashedRun(context: LaneDraw, run: Run, band: LaneBand, labelled: boolean): void {
  const { placement, sink, space } = context;
  const node = run.beat.id;
  const size = EFFECT_TEXT * space;
  const baseline = band.bottom - TEXT_LIFT * space;
  const y = baseline - textExtent(size).ascent / 2;
  let start = placement.x;
  const label = runLabel(run);
  if (labelled && label) {
    const primitive = text(label, placement.onsetX(run.start), baseline, size, {
      anchor: 'middle',
      node,
    });
    sink.primitives.push(primitive);
    start = primitive.bbox.x + primitive.bbox.width + LABEL_GAP * space;
  }
  const on = continuesOn(context, run);
  const end = on ? carriedEnd(placement) : placement.onsetX(run.last);
  if (end - start < MIN_LINE * space) return;
  sink.primitives.push(
    line(start, y, end, y, RUN_LINE * space, { dash: [DASH[0] * space, DASH[1] * space], node }),
  );
  if (!on) {
    const half = (END_TICK * space) / 2;
    sink.primitives.push(line(end, y - half, end, y + half, RUN_LINE * space, { node }));
  }
}

function waveEnd(context: LaneDraw, run: Run): number {
  const { placement, space, effects } = context;
  if (continuesOn(context, run)) return carriedEnd(placement);
  const end =
    run.end < effects.end - TICK_EPSILON ? placement.onsetX(run.end) : contentEnd(placement);
  return end - WAVE_STOP * space;
}

function drawWaveRun(context: LaneDraw, run: Run, band: LaneBand, labelled: boolean): void {
  const { placement, sink, space } = context;
  const node = run.beat.id;
  const y = (band.top + band.bottom) / 2;
  const from = continuesFrom(context, run);
  let start = from ? placement.x : placement.onsetX(run.start);
  if (run.lane === 'trill' && labelled) {
    const name = 'ornamentTrill';
    const { bbox } = glyphMetrics(name);
    const x = placement.onsetX(run.start) - ((bbox.left + bbox.right) / 2) * space;
    const drawn = glyph(name, x, y + ((bbox.top + bbox.bottom) / 2) * space, space, { node });
    sink.primitives.push(drawn);
    start = drawn.bbox.x + drawn.bbox.width + TRILL_GAP * space;
  }
  const end = waveEnd(context, run);
  const shape =
    run.lane === 'trill'
      ? WAVES.trill
      : run.lane === 'beatVibrato'
        ? SAWTOOTH[run.width]
        : WAVES[run.width];
  const drawn =
    run.lane === 'beatVibrato'
      ? sawtooth(start, end, y, shape, space, { node })
      : horizontalWave(start, end, y, shape, space, { node });
  if (drawn) sink.primitives.push(drawn);
}

function drawWhammies(context: LaneDraw, band: LaneBand): void {
  const { placement, sink, space, effects } = context;
  const middle = band.top + WHAMMY.middle * space;
  const labelSize = WHAMMY.label * space;
  const level = (value: number): number =>
    middle - Math.max(-WHAMMY.limit, Math.min(WHAMMY.limit, value)) * WHAMMY.step * space;
  for (const { beat, tick, next } of effects.whammies) {
    const { whammy } = beat.effects;
    if (!whammy) continue;
    const x0 = placement.onsetX(tick);
    const stop =
      (next === undefined ? contentEnd(placement) : placement.onsetX(next)) - WHAMMY.stop * space;
    const x1 = Math.max(stop, x0 + space);
    const at = (position: number): number => x0 + (position / 60) * (x1 - x0);
    const node = beat.id;
    sink.primitives.push(
      polyline(
        whammy.points.map((p): [number, number] => [at(p.position), level(p.value)]),
        RUN_LINE * space,
        { node },
      ),
    );
    let extreme = whammy.points[0];
    for (const p of whammy.points)
      if (extreme && Math.abs(p.value) > Math.abs(extreme.value)) extreme = p;
    const final = whammy.points.at(-1);
    const labelled = [extreme];
    if (final && final.value !== 0 && final.value !== extreme?.value) labelled.push(final);
    for (const p of labelled) {
      if (!p || p.value === 0) continue;
      const y =
        p.value >= 0
          ? level(p.value) - WHAMMY.gap * space
          : level(p.value) + WHAMMY.gap * space + textExtent(labelSize).ascent;
      sink.primitives.push(
        text(bendLabel(p.value), at(p.position), y, labelSize, { anchor: 'middle', node }),
      );
    }
  }
}

/** Draws a bar's lane effects into the bands the system gives them; a lane without a band draws nothing. */
export function drawLanes(context: LaneDraw): void {
  const { placement, sink, space, effects } = context;
  const { lanes } = placement;
  for (const item of effects.items) {
    const band = lanes[item.lane];
    if (band) drawItem(context, item, band);
  }
  for (const run of effects.runs) {
    const band = lanes[run.lane];
    if (!band) continue;
    const labelled = !continuesFrom(context, run) || placement.lineStart;
    switch (run.lane) {
      case 'palmMute':
      case 'letRing':
      case 'harmonic':
        drawDashedRun(context, run, band, labelled);
        break;
      case 'vibrato':
      case 'beatVibrato':
      case 'trill':
        drawWaveRun(context, run, band, labelled);
        break;
      case 'whammy':
        if (labelled) {
          const y = band.top + WHAMMY.baseline * space;
          sink.primitives.push(
            text('w/bar', placement.onsetX(run.start), y, WHAMMY_TEXT * space, {
              node: run.beat.id,
            }),
          );
        }
        break;
    }
  }
  if (lanes.whammy) drawWhammies(context, lanes.whammy);
}
