import { barTicks, playedBarTicks, type Score } from '@reprise/model';

/**
 * A master bar's length on gpif's automation timeline: its written length, or its longest voice
 * when that is longer (an over-full bar), as playback times it. Unlike `playedBarTicks`, a short
 * pickup keeps its written length, so a ramp out of it is measured as it always was.
 */
export function automationBarTicks(
  score: Pick<Score, 'masterBars' | 'tracks'>,
  masterBarIndex: number,
): number {
  const played = playedBarTicks(score, masterBarIndex);
  const masterBar = score.masterBars[masterBarIndex];
  return masterBar ? Math.max(barTicks(masterBar), played) : played;
}

/** Bar start ticks on that timeline, with the score's end as the last entry. */
export function automationBarStarts(score: Pick<Score, 'masterBars' | 'tracks'>): number[] {
  const starts = [0];
  for (let index = 0; index < score.masterBars.length; index++) {
    starts.push((starts.at(-1) ?? 0) + automationBarTicks(score, index));
  }
  return starts;
}
