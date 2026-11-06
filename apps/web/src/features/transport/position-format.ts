import type { PositionEvent, Timeline } from '@reprise/audio';
import { barTicks } from '@reprise/model';

export interface PositionText {
  bar: string;
  beat: string;
  time: string;
  /** What the announcer reads. */
  sentence: string;
}

const WHOLE_NOTE = 3840;
const EPSILON = 1e-6;

/** `m:ss`, or `h:mm:ss` from an hour. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds + EPSILON));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${s}` : `${String(m)}:${s}`;
}

const NONE: PositionText = { bar: '–', beat: '–', time: '0:00 / 0:00', sentence: 'No song open' };

/**
 * The readout for a position: the written bar number (a repeat's second pass shows the same bar),
 * the metronome's beat within it, and song time at the written tempo, whatever the speed.
 */
export function describePosition(
  timeline: Timeline | undefined,
  event: PositionEvent | undefined,
): PositionText {
  if (!timeline) return NONE;
  const { map, score } = timeline;
  const sequenceIndex = event?.position.sequenceIndex ?? 0;
  const pass = map.passes[sequenceIndex] ?? map.passes[0];
  const masterBarIndex = event?.position.masterBarIndex ?? pass?.masterBarIndex ?? 0;
  const masterBar = score.masterBars[masterBarIndex];
  if (!pass || !masterBar) return { ...NONE, sentence: 'Empty song' };

  const bars = score.masterBars.length;
  const barNumber = masterBarIndex + 1;
  const { numerator, denominator } = masterBar.timeSignature;
  const unit = WHOLE_NOTE / denominator;
  // A pickup bar is missing its first beats, so its first played beat is not beat 1.
  const missing = Math.max(0, barTicks(masterBar) - pass.ticks);
  const tick = event?.position.tick ?? 0;
  const beatNumber = Math.min(numerator, Math.floor((tick + missing) / unit + EPSILON) + 1);
  const elapsed = clock(event?.seconds ?? 0);
  const total = clock(map.durationSeconds);
  const countingIn = event?.countingIn ?? false;

  return {
    bar: `${String(barNumber)}/${String(bars)}`,
    beat: countingIn ? 'Count-in' : `${String(beatNumber)}/${String(numerator)}`,
    time: `${elapsed} / ${total}`,
    sentence: countingIn
      ? `Counting in before bar ${String(barNumber)} of ${String(bars)}`
      : `Bar ${String(barNumber)} of ${String(bars)}, beat ${String(beatNumber)} of ${String(numerator)}, ${elapsed} of ${total}`,
  };
}
