import type { BarContext } from './context';
import { clefWidth, keyWidth, timeWidth } from './furniture';
import { barWidth, fixedWidth, springTotal, type BarMeasure } from './measure';
import { textWidth } from './metrics';
import type { ResolvedOptions } from './options';
import type { StaffSlot } from './slots';

/** Track names' font size, in staff spaces. */
export const NAME_SIZE = 1.6;
/** A last system shorter than this share of the width keeps its natural spacing. */
const JUSTIFY_LAST = 0.75;
const PREFIX_LEAD = 0.5;
const CLEF_TRAIL = 0.8;
/** Gap between a system's last bar line and the courtesy signatures after it, in staff spaces. */
export const COURTESY_LEAD = 0.6;

export interface SystemPlan {
  /** Master-bar indices, end exclusive. */
  start: number;
  end: number;
  /** Paged mode: every system. Continuous mode: only the first, the start of the one line. */
  opensLine: boolean;
  /** The score's first system: full track names rather than short ones. */
  first: boolean;
  indent: number;
  /** Width of the clefs and key signature that open the line. */
  prefix: number;
  /** Scale applied to the bars' springs to fill the width. */
  factor: number;
  /** Width of the bars once stretched. */
  width: number;
  /**
   * Width of the courtesy key and time signatures after the last bar line, announcing a change
   * at the next system's first bar; 0 when it has none.
   */
  courtesy: number;
}

export function nameIndent(options: ResolvedOptions, full: boolean): number {
  const size = NAME_SIZE * options.space;
  const widest = Math.max(
    0,
    ...options.tracks.map(({ track }) => textWidth(full ? track.name : track.shortName, size)),
  );
  return widest > 0 ? widest + options.space * 1.5 : 0;
}

export function prefixWidth(
  context: BarContext,
  slots: readonly StaffSlot[],
  space: number,
): number {
  const clefs = Math.max(
    0,
    ...slots.map((slot) => clefWidth(slot.box, context.clefs[slot.group] ?? 'treble', space)),
  );
  const key = slots.some((slot) => slot.type === 'standard')
    ? keyWidth(context.masterBar.keySignature.fifths, space)
    : 0;
  return (PREFIX_LEAD + CLEF_TRAIL) * space + clefs + key;
}

/**
 * Width of the courtesy signatures a paged system ending before bar `index` carries: the key
 * (with its cancelling naturals) and the time signature that bar changes to.
 */
export function courtesyWidth(
  contexts: readonly BarContext[],
  index: number,
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
): number {
  const context = contexts[index];
  if (options.mode !== 'paged' || !context || index === 0) return 0;
  const { space } = options;
  const { keySignature, timeSignature } = context.masterBar;
  const previous = contexts[index - 1]?.masterBar.keySignature.fifths;
  const key =
    context.keyChange && slots.some((slot) => slot.type === 'standard')
      ? keyWidth(keySignature.fifths, space, previous)
      : 0;
  const time = context.showTime
    ? Math.max(0, ...slots.map((slot) => timeWidth(slot.box, timeSignature, space)))
    : 0;
  return key + time > 0 ? COURTESY_LEAD * space + key + time : 0;
}

function finish(
  plan: Omit<SystemPlan, 'factor' | 'width'>,
  measures: readonly BarMeasure[],
  available: number,
  fit: boolean,
): SystemPlan {
  let fixed = 0;
  let springs = 0;
  for (let i = plan.start; i < plan.end; i++) {
    const measure = measures[i];
    if (!measure) continue;
    fixed += fixedWidth(measure, plan.opensLine && i === plan.start);
    springs += springTotal(measure);
  }
  const room = available - plan.courtesy;
  const factor = fit && springs > 0 ? Math.max(0, (room - fixed) / springs) : 1;
  let width = 0;
  for (let i = plan.start; i < plan.end; i++) {
    const measure = measures[i];
    if (measure) width += barWidth(measure, plan.opensLine && i === plan.start, factor);
  }
  return { ...plan, factor, width };
}

/**
 * Greedy line filling from bar `from`: each system takes bars while their natural widths fit,
 * and always at least one, so a bar wider than the page overflows rather than splitting. Lazy, so
 * a re-layout stops asking once the breaks meet the cached ones again.
 */
export function* breakSystems(
  measures: readonly BarMeasure[],
  contexts: readonly BarContext[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  from: number,
): Generator<SystemPlan, void, undefined> {
  const { space, margins, mode } = options;
  const lineWidth = options.width - margins.left - margins.right;
  let start = from;
  while (start < measures.length) {
    const first = start === 0;
    const opensLine = mode === 'paged' || first;
    const indent = opensLine ? nameIndent(options, first) : 0;
    const context = contexts[start];
    const prefix = opensLine && context ? prefixWidth(context, slots, space) : 0;
    const available = Math.max(
      space,
      (mode === 'paged' ? lineWidth : options.width) - indent - prefix,
    );

    let end = start;
    let used = 0;
    while (end < measures.length) {
      const measure = measures[end];
      if (!measure) break;
      const width = barWidth(measure, opensLine && end === start);
      const courtesy = courtesyWidth(contexts, end + 1, slots, options);
      if (end > start && used + width + courtesy > available) break;
      used += width;
      end += 1;
    }

    const last = end >= measures.length;
    const courtesy = courtesyWidth(contexts, end, slots, options);
    const fit = mode === 'paged' && (!last || used + courtesy >= available * JUSTIFY_LAST);
    yield finish(
      { start, end, opensLine, first, indent, prefix, courtesy },
      measures,
      available,
      fit,
    );
    start = end;
  }
}
