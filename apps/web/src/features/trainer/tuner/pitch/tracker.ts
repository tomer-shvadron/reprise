import type { PitchDetection } from './mpm';

export interface Reading {
  hz: number;
  /** Fractional MIDI against the tracker's reference pitch; the cents are its distance to the nearest whole note. */
  midi: number;
  /** The signal has gone quiet and this is the last reading, kept for a moment. */
  held: boolean;
  inTune: boolean;
}

export interface TrackerOptions {
  /** A4 in Hz; 440 by default. */
  referenceHz?: number;
}

export interface TrackerStep {
  reading: Reading | undefined;
  /** The lowpass cutoff the capture should be using for the next frames. */
  cutoffHz: number;
}

/** Thresholds, settled by the pipeline tests in `tracker.test.ts`. */
export const TRACKER = {
  /** A frame quieter than this (dBFS, RMS) is silence. */
  floorDb: -55,
  /** A locked note ends when its level falls this far below its peak, before noise takes over. */
  tailDb: 30,
  newClarity: 0.9,
  lockedClarity: 0.8,
  lockWithinCents: 30,
  /** Frames this far from the lock's median do not belong to it. */
  awayCents: 50,
  moveFrames: 3,
  median: 5,
  holdMs: 1500,
  inTuneCents: 3,
  outOfTuneCents: 5,
  inTuneReadings: 5,
  searchCutoffHz: 1500,
  lockedCutoffFactor: 2.5,
  minCutoffHz: 80,
  /**
   * Accepted frames after a lock before it reports. The cutoff has moved by then, and frames
   * read through the old one are sharp on a stiff string; the last `settleFrames - 2` of them
   * build the first median.
   */
  settleFrames: 5,
  /** Rejected frames in a row before the cutoff opens up again for the next note. */
  openAfterRejects: 5,
} as const;

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

const centsBetween = (a: number, b: number) => Math.abs(a - b) * 100;

/**
 * Turns the detector's frames into a steady reading: gates by level and clarity, locks a note
 * after two agreeing frames, smooths with a median, holds the reading briefly when the string
 * dies away and decides when the note counts as in tune. Pure and stateful; no clock of its own.
 */
export function createTracker(options: TrackerOptions = {}) {
  let referenceHz = options.referenceHz ?? 440;
  const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / referenceHz);

  let history: number[] = [];
  let locked = false;
  let peakRms = 0;
  let pending: number | undefined;
  let away: number[] = [];
  let lastAcceptedMs = 0;
  let lastReading: Reading | undefined;
  let streak = 0;
  let inTune = false;
  let rejects = 0;
  let cutoffHz: number = TRACKER.searchCutoffHz;
  let settling = 0;

  const unlock = () => {
    locked = false;
    history = [];
    pending = undefined;
    away = [];
    peakRms = 0;
    lastReading = undefined;
    streak = 0;
    inTune = false;
    cutoffHz = TRACKER.searchCutoffHz;
    settling = 0;
  };

  /** Starts a lock on `midi`'s note, hidden until the new cutoff has had its effect. */
  const begin = (frames: number[], rmsValue: number, hz: number) => {
    history = frames;
    peakRms = rmsValue;
    away = [];
    pending = undefined;
    streak = 0;
    inTune = false;
    lastReading = undefined;
    const target = Math.min(
      TRACKER.searchCutoffHz,
      Math.max(TRACKER.minCutoffHz, TRACKER.lockedCutoffFactor * hz),
    );
    // Only a cutoff that closes in leaves sharp frames behind; one that opens does not.
    settling = target < 0.85 * cutoffHz ? TRACKER.settleFrames : 0;
    cutoffHz = target;
  };

  const emit = (midi: number): Reading => {
    const cents = Math.abs(midi - Math.round(midi)) * 100;
    if (cents <= TRACKER.inTuneCents) streak += 1;
    else streak = 0;
    if (inTune) inTune = cents <= TRACKER.outOfTuneCents;
    else inTune = streak >= TRACKER.inTuneReadings;
    const hz = referenceHz * 2 ** ((midi - 69) / 12);
    cutoffHz = Math.min(
      TRACKER.searchCutoffHz,
      Math.max(TRACKER.minCutoffHz, TRACKER.lockedCutoffFactor * hz),
    );
    lastReading = { hz, midi, held: false, inTune };
    return lastReading;
  };

  return {
    /** A new reference changes every note's cents, so the lock starts over. */
    setReference(hz: number) {
      referenceHz = hz;
      unlock();
    },

    reset: unlock,

    push(detection: PitchDetection | undefined, rmsValue: number, timeMs: number): TrackerStep {
      const midi = detection ? midiOf(detection.hz) : undefined;
      const centre = locked ? median(history) : undefined;
      const near =
        midi !== undefined &&
        centre !== undefined &&
        centsBetween(midi, centre) <= TRACKER.awayCents;
      const level =
        rmsValue >= 10 ** (TRACKER.floorDb / 20) &&
        (!locked || rmsValue >= peakRms * 10 ** (-TRACKER.tailDb / 20));
      const clarityNeeded = locked && near ? TRACKER.lockedClarity : TRACKER.newClarity;
      const accepted =
        midi !== undefined &&
        detection !== undefined &&
        level &&
        detection.clarity >= clarityNeeded;

      if (!accepted) {
        pending = undefined;
        rejects += 1;
        if (rejects >= TRACKER.openAfterRejects) cutoffHz = TRACKER.searchCutoffHz;
        if (locked) {
          if (timeMs - lastAcceptedMs > TRACKER.holdMs) {
            unlock();
            return { reading: undefined, cutoffHz };
          }
          return { reading: lastReading && { ...lastReading, held: true }, cutoffHz };
        }
        return { reading: undefined, cutoffHz };
      }

      rejects = 0;
      lastAcceptedMs = timeMs;

      if (!locked) {
        if (pending !== undefined && centsBetween(pending, midi) <= TRACKER.lockWithinCents) {
          locked = true;
          begin([pending, midi], rmsValue, detection.hz);
          return { reading: settling > 0 ? undefined : emit(median(history)), cutoffHz };
        }
        pending = midi;
        return { reading: undefined, cutoffHz };
      }

      if (near) {
        away = [];
        history.push(midi);
        if (history.length > TRACKER.median) history.shift();
        peakRms = Math.max(peakRms, rmsValue);
        if (settling > 0) {
          settling -= 1;
          // The first frames went through the old cutoff; keep only the later ones.
          if (settling === TRACKER.settleFrames - 3) history = [midi];
          if (settling > 0) return { reading: undefined, cutoffHz };
        }
        return { reading: emit(median(history)), cutoffHz };
      }

      // Far from the lock: one stray frame (an octave error, a click) is ignored, and a note
      // that persists takes the lock over.
      const last = away.at(-1);
      away =
        last !== undefined && centsBetween(last, midi) > TRACKER.lockWithinCents
          ? [midi]
          : [...away, midi];
      if (away.length >= TRACKER.moveFrames) {
        begin(away, rmsValue, detection.hz);
        return { reading: settling > 0 ? undefined : emit(median(history)), cutoffHz };
      }
      return { reading: lastReading, cutoffHz };
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
