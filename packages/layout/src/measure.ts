import { PPQ, barTicks, beatTicks, playedBarTicks, type Score } from '@reprise/model';

import type { BarContext } from './context';
import {
  CLEF_CHANGE_SCALE,
  clefWidth,
  endBarline,
  endBarlineWidth,
  keyWidth,
  repeatStartWidth,
  timeWidth,
  type EndBarline,
} from './furniture';
import { headerWidth } from './header';
import { staffBar, trackBar, type StaffSlot } from './slots';
import { durationWidth, rigidShares, segmentWidth, squeezedMin, type Spring } from './spacing';
import { TICK_EPSILON } from './ticks';

/** Room between neighbouring onsets' extents, and around a bar's content, in staff spaces. */
const ONSET_GAP = 0.3;
const LEAD = 1;
const TRAIL = 0.6;
const MARK_GAP = 0.2;

/** A master bar's column across every visible staff, before it is placed in a system. */
export interface BarMeasure {
  /** Ticks from the bar start of every onset in any visible voice; `[0]` for an empty bar. */
  onsets: number[];
  /** One per onset: from it to the next, the last to the bar's end. */
  springs: Spring[];
  /** From the content start to the first onset, and after the last spring. */
  leading: number;
  trailing: number;
  /** The part of `trailing` kept for header markings wider than the bar; an over-wide bar gives it up. */
  pad: number;
  /** Widths of the signature parts at the bar start; zero when the bar shows none. */
  clefChange: number;
  keyChange: number;
  time: number;
  repeatStart: number;
  endKind: EndBarline;
  end: number;
  /** Room above and below each staff, in `staffSlots` order. */
  extents: { above: number; below: number }[];
}

/** The bar's width when it opens a system (whose prefix shows clef and key) or not. */
export function barWidth(
  measure: BarMeasure,
  opensSystem: boolean,
  factor = 1,
  squeeze = 1,
  rigidScale = 1,
  fixedScale = 1,
  markScale = 1,
): number {
  let content = 0;
  for (const spring of measure.springs) {
    content += Math.max(
      squeezedMin(spring, squeeze, rigidScale, fixedScale, markScale),
      spring.natural * factor,
    );
  }
  return fixedWidth(measure, opensSystem) + content;
}

export function fixedWidth(measure: BarMeasure, opensSystem: boolean): number {
  return (
    (opensSystem ? 0 : measure.clefChange + measure.keyChange) +
    measure.time +
    measure.repeatStart +
    measure.leading +
    measure.trailing +
    measure.end
  );
}

export function springTotal(measure: BarMeasure): number {
  let total = 0;
  for (const { natural } of measure.springs) total += natural;
  return total;
}

/** Index of the onset at `tick` in sorted `onsets`, or of the nearest one. */
export function onsetIndex(onsets: readonly number[], tick: number): number {
  let low = 0;
  let high = onsets.length - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((onsets[middle] ?? 0) < tick - TICK_EPSILON) low = middle + 1;
    else high = middle;
  }
  const before = onsets[low - 1];
  if (before !== undefined && Math.abs(before - tick) < Math.abs((onsets[low] ?? 0) - tick)) {
    return low - 1;
  }
  return low;
}

interface Onset {
  tick: number;
  governing: number;
}

function columnOnsets(score: Score, slots: readonly StaffSlot[], index: number): Onset[] {
  const raw: Onset[] = [];
  const seen = new Set<number>();
  for (const slot of slots) {
    if (seen.has(slot.group)) continue;
    seen.add(slot.group);
    for (const voice of trackBar(slot, index)?.voices ?? []) {
      // Guitar Pro's unused voices, and its tacet bars, hold only empty beats.
      if (!voice.beats.some((beat) => beat.rest || beat.notes.length > 0)) continue;
      let tick = 0;
      for (const beat of voice.beats) {
        const ticks = beatTicks(beat);
        raw.push({ tick, governing: ticks });
        tick += ticks;
      }
    }
  }
  raw.sort((a, b) => a.tick - b.tick || a.governing - b.governing);
  const merged: Onset[] = [];
  for (const onset of raw) {
    const last = merged.at(-1);
    if (last && onset.tick - last.tick < TICK_EPSILON) {
      last.governing = Math.min(last.governing, onset.governing);
    } else {
      merged.push({ ...onset });
    }
  }
  return merged;
}

function endTick(score: Score, index: number, onsets: readonly Onset[]): number {
  const masterBar = score.masterBars[index];
  const written = masterBar ? barTicks(masterBar) : 0;
  const last = onsets.at(-1);
  const contentEnd = last ? last.tick + last.governing : 0;
  if (masterBar?.anacrusis) return Math.max(playedBarTicks(score, index), contentEnd);
  return Math.max(written, contentEnd);
}

export function measureBar(
  score: Score,
  context: BarContext,
  slots: readonly StaffSlot[],
  space: number,
): BarMeasure {
  const { index, masterBar } = context;
  let onsets = columnOnsets(score, slots, index);
  const end = endTick(score, index, onsets);
  const empty = onsets.length === 0;
  if (empty) onsets = [{ tick: 0, governing: end }];
  const ticks = onsets.map(({ tick }) => tick);
  const left = ticks.map(() => 0);
  const right = ticks.map(() => 0);
  const rigid = ticks.map(() => 0);
  const fixed = ticks.map(() => 0);
  const ideal = ticks.map(() => 0);
  // Room the fingering of two neighbouring marked onsets needs between them, `from` to `to`.
  const clearances: { from: number; to: number; need: number }[] = [];

  const extents = slots.map((slot) => {
    const bar = trackBar(slot, index);
    if (!bar) return { above: 0, below: 0 };
    const measured = slot.module.measure(staffBar(score, slot, bar, context, space));
    const marks: ({ left: number; right: number } | undefined)[] = ticks.map(() => undefined);
    for (const extent of measured.onsets) {
      if (extent.marks) {
        const j = onsetIndex(ticks, extent.tick);
        const had = marks[j];
        marks[j] = {
          left: Math.max(had?.left ?? -Infinity, extent.marks.left),
          right: Math.max(had?.right ?? -Infinity, extent.marks.right),
        };
      }
    }
    let prev = -1;
    for (const [j, mark] of marks.entries()) {
      if (!mark) continue;
      const before = marks[prev];
      if (before)
        clearances.push({ from: prev, to: j, need: before.right + mark.left + MARK_GAP * space });
      prev = j;
    }
    for (const extent of measured.onsets) {
      const i = onsetIndex(ticks, extent.tick);
      left[i] = Math.max(left[i] ?? 0, extent.left);
      right[i] = Math.max(right[i] ?? 0, extent.right);
      rigid[i] = Math.max(rigid[i] ?? 0, extent.rigid ?? 0);
      fixed[i] = Math.max(fixed[i] ?? 0, extent.fixed ?? extent.rigid ?? 0);
      ideal[i] = Math.max(ideal[i] ?? 0, extent.ideal ?? 0);
    }
    return { above: measured.above, below: measured.below };
  });

  // A spring's room at scales (fs, rs) is fixed*fs + movable*rs, with movable = R share - F share
  // (so it can be negative for one spring), R and F being the suffix-maxima shares of the onsets'
  // totals and floors. At fs = rs = 1 that is the R share, exactly main's rigid room, so a bar
  // that fits never changes. At any scales the room is fs*F share + rs*(R share - F share); the
  // suffix sums of both share sets hold each onset's own extent (floor F_i, total R_i), and the
  // mix of two valid share sets holds the chord's
  // extent F_i*fs + (R_i - F_i)*rs, since the sum over springs of F share is >= F_i and of R share
  // is >= R_i. Taking each part's own suffix maximum instead would sum to max F + max M > max R.
  const fixedParts = rigidShares(fixed);
  const totalParts = rigidShares(rigid);
  const movableParts = totalParts.map((total, i) => total - (fixedParts[i] ?? 0));
  const springs = onsets.map(({ tick, governing }, i): Spring => {
    const next = onsets[i + 1]?.tick ?? end;
    const gap = Math.max(next - tick, TICK_EPSILON);
    const movablePart = movableParts[i] ?? 0;
    const fixedPart = fixedParts[i] ?? 0;
    // What the springs from here to the next marked onset already hold of the room takes off
    // what this one adds. At `markScale` 1 every scale is 1, so each spring holds its F + M.
    let marksPart = 0;
    for (const { from, to, need } of clearances) {
      if (from !== i) continue;
      let held = 0;
      for (let k = from; k < to; k++) held += (fixedParts[k] ?? 0) + (movableParts[k] ?? 0);
      marksPart = Math.max(marksPart, need - held);
    }
    marksPart = Math.max(0, marksPart);
    const min = Math.max(
      (right[i] ?? 0) + (i + 1 < onsets.length ? (left[i + 1] ?? 0) : 0) + ONSET_GAP * space,
      fixedPart + movablePart + marksPart,
    );
    // alphaTab fills an empty voice with one beat of its default duration, a quarter.
    const natural = empty ? durationWidth(PPQ, space) : segmentWidth(gap, governing, space);
    const wish =
      (ideal[i] ?? 0) + (i + 1 < onsets.length ? (left[i + 1] ?? 0) : 0) + ONSET_GAP * space;
    return {
      natural: Math.max(min, natural, wish),
      min,
      rigid: fixedPart,
      movable: movablePart,
      marks: marksPart,
    };
  });

  const standardSlots = slots.filter((slot) => slot.type === 'standard');
  const clefChange = Math.max(
    0,
    ...slots.map((slot) =>
      context.clefChanges[slot.group] && slot.type === 'standard'
        ? clefWidth(slot.box, context.clefs[slot.group] ?? 'treble', space, CLEF_CHANGE_SCALE) +
          space * 0.6
        : 0,
    ),
  );
  const endKind = endBarline(context);

  const measure: BarMeasure = {
    onsets: ticks,
    springs,
    leading: Math.max(LEAD * space, (left[0] ?? 0) + ONSET_GAP * space),
    trailing: TRAIL * space,
    pad: 0,
    clefChange,
    keyChange:
      context.keyChange && standardSlots.length > 0
        ? keyWidth(
            masterBar.keySignature.fifths,
            space,
            score.masterBars[index - 1]?.keySignature.fifths,
          )
        : 0,
    time: context.showTime
      ? Math.max(0, ...slots.map((slot) => timeWidth(slot.box, masterBar.timeSignature, space)))
      : 0,
    repeatStart: masterBar.repeat.start ? repeatStartWidth(space) : 0,
    endKind,
    end: endBarlineWidth(endKind, space),
    extents,
  };
  const shortfall = headerWidth(masterBar, space) - barWidth(measure, false);
  if (shortfall > 0) {
    measure.trailing += shortfall;
    measure.pad = shortfall;
  }
  return measure;
}
