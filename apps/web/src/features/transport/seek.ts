import type { TickRange, Timeline } from '@reprise/audio';
import { beatTicks, type Score, type TempoMapPass } from '@reprise/model';

const EPSILON = 1e-6;

function findLast<T>(items: readonly T[], test: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined && test(item)) return item;
  }
  return undefined;
}

/** The pass holding playback tick `at`: the last one starting at or before it. */
export function passIndexAt(timeline: Timeline, at: number): number {
  const { passes } = timeline.map;
  let low = 0;
  let high = passes.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((passes[middle]?.startTick ?? Infinity) <= at + EPSILON) low = middle;
    else high = middle - 1;
  }
  return low;
}

/**
 * The run around pass `index`: the stretch of consecutive passes that play consecutive master
 * bars. A repeat back, a skipped volta and a jump each end one.
 */
export function runAround(
  passes: readonly TempoMapPass[],
  index: number,
): { start: number; end: number } {
  const follows = (i: number) =>
    (passes[i]?.masterBarIndex ?? -2) === (passes[i - 1]?.masterBarIndex ?? -3) + 1;
  let start = index;
  while (start > 0 && follows(start)) start -= 1;
  let end = index;
  while (end + 1 < passes.length && follows(end + 1)) end += 1;
  return { start, end };
}

/**
 * The playback tick a click on `target` seeks to. Of the passes playing its bar: the one in the
 * playhead's run, else the next after the playhead, else the last before it. So clicking back
 * during a first time through a repeat stays in that time through. With `loop`, only passes
 * inside it count, when any does. Undefined for a bar no pass plays.
 */
export function seekTick(
  timeline: Timeline,
  target: { masterBarIndex: number; tick: number },
  at: number,
  loop?: TickRange,
): number | undefined {
  const { passes } = timeline.map;
  if (passes.length === 0) return undefined;
  const all = [...passes.keys()].filter((i) => passes[i]?.masterBarIndex === target.masterBarIndex);
  const inLoop =
    loop &&
    all.filter((i) => {
      const start = passes[i]?.startTick ?? -1;
      return start >= loop.startTick - EPSILON && start < loop.endTick - EPSILON;
    });
  const candidates = inLoop && inLoop.length > 0 ? inLoop : all;
  const current = passIndexAt(timeline, at);
  const run = runAround(passes, current);
  const chosen =
    candidates.find((i) => i >= run.start && i <= run.end) ??
    candidates.find((i) => i > current) ??
    findLast(candidates, (i) => i < current);
  const pass = chosen === undefined ? undefined : passes[chosen];
  if (!pass) return undefined;
  return pass.startTick + Math.min(Math.max(target.tick, 0), pass.ticks - EPSILON);
}

/**
 * The onsets a beat step stops at in a bar, as ticks into it: the track's first voice, or every
 * voice's when the first is empty, or the bar's start when the track plays nothing there.
 */
export function trackOnsets(score: Score, trackIndex: number, masterBarIndex: number): number[] {
  const voices = score.tracks[trackIndex]?.bars[masterBarIndex]?.voices ?? [];
  const starts = (beats: readonly Parameters<typeof beatTicks>[0][]) => {
    const ticks: number[] = [];
    let tick = 0;
    for (const beat of beats) {
      ticks.push(tick);
      tick += beatTicks(beat);
    }
    return ticks;
  };
  const first = voices[0]?.beats ?? [];
  const ticks = first.length > 0 ? starts(first) : voices.flatMap((voice) => starts(voice.beats));
  const unique = [...new Set(ticks.map((tick) => Math.round(tick * 1e6) / 1e6))].sort(
    (a, b) => a - b,
  );
  return unique.length > 0 ? unique : [0];
}

export type SeekStep =
  'previousBeat' | 'nextBeat' | 'previousBar' | 'nextBar' | 'barStart' | 'firstBar' | 'lastBar';

/**
 * The playback tick a keyboard step moves to from `at`, in playback order, so steps go through
 * repeats as they play. Undefined when the step cannot move.
 */
export function stepTick(
  timeline: Timeline,
  at: number,
  step: SeekStep,
  options: { running: boolean; trackIndex: number },
): number | undefined {
  const { passes } = timeline.map;
  if (passes.length === 0) return undefined;
  const index = passIndexAt(timeline, at);
  const pass = passes[index];
  if (!pass) return undefined;
  const local = at - pass.startTick;
  const onsetsOf = (p: TempoMapPass) =>
    trackOnsets(timeline.score, options.trackIndex, p.masterBarIndex).filter(
      (tick) => tick < p.ticks - EPSILON,
    );
  const previous = passes[index - 1];
  const next = passes[index + 1];
  const lastOnsetOf = (p: TempoMapPass) => p.startTick + (onsetsOf(p).at(-1) ?? 0);

  let tick: number | undefined;
  switch (step) {
    case 'nextBeat': {
      const onset = onsetsOf(pass).find((t) => t > local + EPSILON);
      tick = onset === undefined ? next?.startTick : pass.startTick + onset;
      break;
    }
    case 'previousBeat': {
      const onsets = onsetsOf(pass);
      // While running, the beat sounding is already behind the playhead: step past it.
      const before = options.running
        ? findLast(onsets, (t) => t <= local + EPSILON)
        : local + EPSILON;
      const onset =
        before === undefined ? undefined : findLast(onsets, (t) => t < before - EPSILON);
      tick = onset === undefined ? previous && lastOnsetOf(previous) : pass.startTick + onset;
      break;
    }
    case 'nextBar':
      tick = next?.startTick;
      break;
    case 'previousBar':
      tick = !options.running && local > EPSILON ? pass.startTick : previous?.startTick;
      break;
    case 'barStart':
      tick = pass.startTick;
      break;
    case 'firstBar':
      tick = 0;
      break;
    case 'lastBar':
      tick = passes.at(-1)?.startTick;
      break;
  }
  return tick === undefined || Math.abs(tick - at) < EPSILON ? undefined : tick;
}
