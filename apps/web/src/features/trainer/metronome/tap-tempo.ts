/** A pause longer than this starts a new tap sequence rather than averaging in a stale tap. */
export const TAP_RESET_MS = 2000;
/** How many of the latest taps are averaged. */
const TAP_WINDOW = 8;

export const CLICK_BPM = { min: 10, max: 600 } as const;

export function clampClickBpm(bpm: number): number {
  return Math.min(CLICK_BPM.max, Math.max(CLICK_BPM.min, bpm));
}

/** The taps that still count after one at `time`: a long pause drops the earlier ones. */
export function addTap(taps: readonly number[], time: number): number[] {
  const last = taps.at(-1);
  const kept = last !== undefined && time - last > TAP_RESET_MS ? [] : taps;
  return [...kept, time].slice(-TAP_WINDOW);
}

/** The tempo the taps imply, rounded to a whole BPM; undefined until there are two. */
export function tapBpm(taps: readonly number[]): number | undefined {
  const first = taps[0];
  const last = taps.at(-1);
  if (first === undefined || last === undefined || taps.length < 2 || last <= first) {
    return undefined;
  }
  const interval = (last - first) / (taps.length - 1);
  return Math.round(clampClickBpm(60_000 / interval));
}
