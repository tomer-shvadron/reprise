import type { Beat } from './beat';
import type { TimeSignature } from './master-bar';

// Internal until WP-011 publishes the timing API; tuplets can make these fractional.
export const PPQ = 960;
const WHOLE_NOTE_TICKS = PPQ * 4;

export function beatTicks(beat: Pick<Beat, 'duration' | 'dots' | 'tuplet'>): number {
  const base = WHOLE_NOTE_TICKS / beat.duration;
  const dotted = base * (2 - 1 / 2 ** beat.dots);
  return beat.tuplet ? (dotted * beat.tuplet.of) / beat.tuplet.n : dotted;
}

export function barTicks(timeSignature: TimeSignature): number {
  return (WHOLE_NOTE_TICKS * timeSignature.numerator) / timeSignature.denominator;
}
