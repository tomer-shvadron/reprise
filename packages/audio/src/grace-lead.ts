import { PPQ, beatTicks } from '@reprise/model';
import type { Beat } from '@reprise/model';

/** The most a beat is handed out early for the grace notes before it: a quarter note. */
export const MAX_GRACE_LEAD = PPQ;

/** Ticks the grace notes played before `beat` take, which the sink needs before `when`. */
export function graceLeadTicks(beat: Beat): number {
  let ticks = 0;
  for (const grace of beat.grace ?? []) {
    if (grace.before) ticks += beatTicks({ duration: grace.duration, dots: 0 });
  }
  return Math.min(ticks, MAX_GRACE_LEAD);
}
