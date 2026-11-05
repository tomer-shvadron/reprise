import type { Voice } from './bar';
import type { Beat } from './beat';
import type { MasterBar } from './master-bar';
import type { Score } from './score';

export const PPQ = 960;
const WHOLE_NOTE_TICKS = PPQ * 4;

/** Ticks are not rounded: a septuplet is 960 × 4 / 7. Round only where an integer is required. */
export function beatTicks(beat: Pick<Beat, 'duration' | 'dots' | 'tuplet'>): number {
  const base = WHOLE_NOTE_TICKS / beat.duration;
  const dotted = base * (2 - 1 / 2 ** beat.dots);
  return beat.tuplet ? (dotted * beat.tuplet.of) / beat.tuplet.n : dotted;
}

/** The written length from the time signature, also for an anacrusis; see `playedBarTicks`. */
export function barTicks(masterBar: Pick<MasterBar, 'timeSignature'>): number {
  const { numerator, denominator } = masterBar.timeSignature;
  return (WHOLE_NOTE_TICKS * numerator) / denominator;
}

/** The offset of `voice.beats[index]` from the start of its bar; `beats.length` gives the voice's end. */
export function beatStartTicks(voice: Pick<Voice, 'beats'>, index: number): number {
  if (!Number.isInteger(index) || index < 0 || index > voice.beats.length) {
    throw new RangeError(
      `beat index ${String(index)} is outside 0 to ${String(voice.beats.length)}`,
    );
  }
  let ticks = 0;
  for (let i = 0; i < index; i++) {
    const beat = voice.beats[i];
    if (beat) ticks += beatTicks(beat);
  }
  return ticks;
}

/**
 * How long a master bar lasts in playback: its written length, except that an anacrusis lasts as
 * long as its longest voice in any track (the written length when every voice is empty).
 */
export function playedBarTicks(
  score: Pick<Score, 'masterBars' | 'tracks'>,
  masterBarIndex: number,
): number {
  const masterBar = score.masterBars[masterBarIndex];
  if (!masterBar) {
    throw new RangeError(`master bar ${String(masterBarIndex)} does not exist`);
  }
  const written = barTicks(masterBar);
  if (!masterBar.anacrusis) return written;
  let longest = 0;
  for (const track of score.tracks) {
    for (const voice of track.bars[masterBarIndex]?.voices ?? []) {
      longest = Math.max(longest, beatStartTicks(voice, voice.beats.length));
    }
  }
  return longest > 0 ? Math.min(longest, written) : written;
}

export interface ScorePosition {
  /** Master-bar index. */
  bar: number;
  /** Beat index in the voice; defaults to 0, the start of the bar. */
  beat?: number;
  /** Track index; defaults to 0. */
  track?: number;
  /** Voice index; defaults to 0. */
  voice?: number;
}

/**
 * The written-order start tick of every master bar, plus the score's end: `masterBars.length + 1`
 * entries, so bar `i` spans `starts[i]` to `starts[i + 1]`. A prefix sum of `playedBarTicks`.
 */
export function barStartTicks(score: Pick<Score, 'masterBars' | 'tracks'>): number[] {
  const starts = [0];
  let ticks = 0;
  for (let i = 0; i < score.masterBars.length; i++) {
    ticks += playedBarTicks(score, i);
    starts.push(ticks);
  }
  return starts;
}

/** The absolute tick of a position in written order, ignoring repeats and jumps. */
export function tickOf(
  score: Pick<Score, 'masterBars' | 'tracks'>,
  position: ScorePosition,
): number {
  const { bar, beat = 0, track = 0, voice = 0 } = position;
  if (!Number.isInteger(bar) || bar < 0 || bar >= score.masterBars.length) {
    throw new RangeError(`master bar ${String(bar)} does not exist`);
  }
  let ticks = 0;
  for (let i = 0; i < bar; i++) ticks += playedBarTicks(score, i);
  if (beat === 0) return ticks;
  const target = score.tracks[track]?.bars[bar]?.voices[voice];
  if (!target) {
    throw new RangeError(
      `track ${String(track)} has no voice ${String(voice)} in bar ${String(bar)}`,
    );
  }
  return ticks + beatStartTicks(target, beat);
}
