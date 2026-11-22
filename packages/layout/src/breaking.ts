import type { BarContext } from './context';
import { clefWidth, keyWidth, timeWidth } from './furniture';
import { barWidth, fixedWidth, springTotal, type BarMeasure } from './measure';
import { textWidth } from './metrics';
import type { ResolvedOptions } from './options';
import type { StaffSlot } from './slots';
import type { Spring } from './spacing';

/** Track names' font size, in staff spaces. */
export const NAME_SIZE = 1.6;
/** The most of the line a track-name indent may take; a longer name is cut with an ellipsis. */
export const NAME_SHARE = 0.4;
/** A last system shorter than this share of the width keeps its natural spacing. */
const JUSTIFY_LAST = 0.75;
/**
 * A kept continuous segment must fill at least this share of the line, unless it is the last, so
 * edits that shrink bars cannot leave a sliver of a segment behind (#147). It is re-broken
 * greedily instead and merges with what follows.
 */
export const UNDERFLOW = 0.5;
/**
 * A kept continuous segment may run this far past the line before it is broken again, unless it
 * holds one bar. Segments are the painter's windows, and their breaks carry no spacing (no
 * justification, no prefix, no courtesy signatures), so a wider one costs a few more mounted
 * elements (the element budget is tested on edited layouts) where a segment that held exactly
 * one line's worth would overflow at the first rhythm edit that widens a bar and push every later
 * break along with it. A boundary still splits ties, effect lines, words and voltas into two
 * pieces, as before.
 */
export const OVERFLOW = 1.5;
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
  /** Below 1 when even the minimums overflow: every minimum is scaled by it. */
  squeeze: number;
  /** Below 1 when even the rigid parts overflow: they are scaled by it, and `squeeze` is 0. */
  rigidScale: number;
  /** Header pad taken back from an over-wide bar, from its bars' `pad` in order. */
  trim: number;
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
  if (widest <= 0) return 0;
  const { mode, margins, width } = options;
  const line = mode === 'paged' ? width - margins.left - margins.right : width;
  return Math.min(widest + options.space * 1.5, NAME_SHARE * line);
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

/**
 * The spring factor that makes the bars' springs fill `content`, solved with the minimums in place:
 * a spring held at its minimum stays there and the others shrink further. When even the minimums
 * overflow, `squeeze` scales the part of each above its `rigid` one, and `rigidScale` the rigid
 * parts too when they alone overflow. `natural` is the springs' natural total.
 */
export function fitSprings(
  bars: readonly (readonly Spring[])[],
  natural: number,
  content: number,
): { factor: number; squeeze: number; rigidScale?: number } {
  let mins = 0;
  let rigids = 0;
  let squeezable = 0;
  let tightest = 0;
  for (const springs of bars) {
    for (const { natural: width, min, rigid = 0 } of springs) {
      mins += min;
      rigids += rigid;
      squeezable += Math.max(0, min - rigid);
      tightest = Math.max(tightest, min / width);
    }
  }
  if (content < rigids) return { factor: 0, squeeze: 0, rigidScale: Math.max(0, content / rigids) };
  if (content < mins) {
    return {
      factor: 0,
      squeeze: squeezable > 0 ? Math.max(0, (content - rigids) / squeezable) : 1,
    };
  }
  const factor = content / natural;
  if (factor >= tightest) return { factor, squeeze: 1 };
  const sorted = bars.flat().sort((a, b) => b.min / b.natural - a.min / a.natural);
  let free = natural;
  let clamped = 0;
  for (const spring of sorted) {
    const candidate = (content - clamped) / free;
    if (candidate >= spring.min / spring.natural) return { factor: candidate, squeeze: 1 };
    free -= spring.natural;
    clamped += spring.min;
  }
  return { factor: 0, squeeze: 1 };
}

/** How much of `trim` each bar from `start` to `end` gives up, taken from their pads in order. */
export function padCuts(
  measures: readonly BarMeasure[],
  start: number,
  end: number,
  trim: number,
): number[] {
  const cuts: number[] = [];
  let left = trim;
  for (let i = start; i < end; i++) {
    const cut = Math.min(left, measures[i]?.pad ?? 0);
    cuts.push(cut);
    left -= cut;
  }
  return cuts;
}

function finish(
  plan: Omit<SystemPlan, 'factor' | 'squeeze' | 'rigidScale' | 'trim' | 'width'>,
  measures: readonly BarMeasure[],
  available: number,
  fit: boolean,
  paged: boolean,
): SystemPlan {
  let fixed = 0;
  let springs = 0;
  let pads = 0;
  for (let i = plan.start; i < plan.end; i++) {
    const measure = measures[i];
    if (!measure) continue;
    fixed += fixedWidth(measure, plan.opensLine && i === plan.start);
    springs += springTotal(measure);
    pads += measure.pad;
  }
  const room = available - plan.courtesy;
  const excess = paged ? fixed + springs - room : 0;
  let trim = 0;
  let factor = 1;
  let squeeze = 1;
  let rigidScale = 1;
  if (excess > 0 && excess <= pads) {
    trim = excess;
  } else if ((excess > 0 || fit) && springs > 0) {
    if (excess > 0) trim = pads;
    const bars: (readonly Spring[])[] = [];
    for (let i = plan.start; i < plan.end; i++) bars.push(measures[i]?.springs ?? []);
    ({ factor, squeeze, rigidScale = 1 } = fitSprings(bars, springs, room - (fixed - trim)));
  }
  const cuts = padCuts(measures, plan.start, plan.end, trim);
  let width = 0;
  for (let i = plan.start; i < plan.end; i++) {
    const measure = measures[i];
    if (!measure) continue;
    width +=
      barWidth(measure, plan.opensLine && i === plan.start, factor, squeeze, rigidScale) -
      (cuts[i - plan.start] ?? 0);
  }
  return { ...plan, factor, squeeze, rigidScale, trim, width };
}

/**
 * Line filling from bar `from`: each system takes bars while their natural widths fit, and always
 * at least one, so a bar wider than the page gets a system of its own and is squeezed into it
 * (`finish`) rather than split. Lazy, so a re-layout stops asking once the breaks meet the cached
 * ones again.
 *
 * In continuous mode `wasBreak` marks the bars that opened a segment in the previous layout. A
 * segment that starts at one keeps its previous extent, up to the next marked bar, for as long as
 * it stays within `UNDERFLOW` to `OVERFLOW` of the line (a last segment may be shorter, and a
 * one-bar segment wider than the band stays whole); otherwise it is broken greedily, and the next segment is kept again
 * as soon as it starts on a marked bar. So a rhythm edit leaves the later breaks where they were instead of moving them down the
 * score (#147). Without `wasBreak` this is plain greedy breaking. A break an edit made is not
 * undone by undoing the edit: the layout that follows keeps the new break while it stays in band.
 */
export function* breakSystems(
  measures: readonly BarMeasure[],
  contexts: readonly BarContext[],
  slots: readonly StaffSlot[],
  options: ResolvedOptions,
  from: number,
  wasBreak?: (index: number) => boolean,
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
    let kept = false;
    if (mode === 'continuous' && wasBreak?.(start)) {
      let stop = start + 1;
      while (stop < measures.length && !wasBreak(stop)) stop += 1;
      let natural = 0;
      for (let i = start; i < stop; i++) {
        const measure = measures[i];
        if (measure) natural += barWidth(measure, opensLine && i === start);
      }
      const fits = natural <= OVERFLOW * available;
      const full = stop >= measures.length || natural >= UNDERFLOW * available;
      if ((fits || stop - start === 1) && full) {
        end = stop;
        used = natural;
        kept = true;
      }
    }
    while (!kept && end < measures.length) {
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
      mode === 'paged',
    );
    start = end;
  }
}
