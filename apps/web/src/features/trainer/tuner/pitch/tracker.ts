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
  /** Settle time after a lock closes the cutoff in, in 20 ms hops of the pushed clock; see `settleFramesFor`. */
  settleFrames?: number;
}

/**
 * Frames to hide after the cutoff closes in on a new lock: those still holding the change, then
 * two more, so the first reading is a median of three clean frames.
 */
export function settleFramesFor(windowMs: number): number {
  return Math.ceil((windowMs + TRACKER.settleMarginMs) / TRACKER.hopMs) + 2;
}

export interface TrackerStep {
  reading: Reading | undefined;
  /** The lowpass cutoff the capture should be using for the next frames. */
  cutoffHz: number;
}

/** Thresholds, settled by the pipeline tests in `tracker.test.ts` and `tracker-pipeline-*.test.ts`. */
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
  /**
   * A click or a dropped sample in the input leaves a few frames a handful of cents off with the
   * clarity dipped below what this note had; the last reading is shown again for them, rather
   * than the new ones. The dip is against the note's own running clarity, so a weak note whose
   * clarity is steady is never suspect. A real change of pitch keeps its clarity, or outlasts
   * `glitchFrames`, and `cleanFrames` clean frames in a row are needed to start the count over,
   * so one clean frame inside a glide cannot restart the freeze.
   */
  glitchClarityDip: 0.05,
  clarityAverage: 0.15,
  cleanFrames: 3,
  glitchCents: 2,
  /**
   * A frame this far from the one before it is no string moving (a bend is a couple of cents a
   * frame, a fast peg turn under 8), and the frames a stream dropout left, 18 and 38 cents off in
   * #433, kept a clarity only 0.03 under the note's, so they need a smaller dip to be suspect than
   * a few cents' drift does.
   */
  bigGlitchCents: 8,
  bigGlitchClarityDip: 0.02,
  glitchFrames: 8,
  searchCutoffHz: 1500,
  lockedCutoffFactor: 2.5,
  minCutoffHz: 80,
  /**
   * Time a window needs to leave a cutoff change behind: the change itself is smoothed over a
   * few milliseconds, and until the window has moved past it the frames hold a phase jump that
   * reads tens of cents off at high clarity.
   */
  settleMarginMs: 60,
  /**
   * Frames the first reading after a settle is the median of, all taken at or after the settle
   * deadline. CI's trace for #318 (48 kHz, 4096-sample window) showed the cutoff change still
   * bending frames 80 ms after the lock, 40 ms past window plus the old 40 ms margin: 4.9 and 2.4
   * cents off at clarity 0.88 and 0.90, first clean window at 171 ms after the lock. A median of
   * one frame passed the 2.4 straight through.
   */
  settledFrames: 3,
  hopMs: 20,
  /** Rejected frames in a row before the cutoff opens up again for the next note. */
  openAfterRejects: 5,
} as const;

// The median of at most `TRACKER.median` values, sorted into a scratch array that is kept.
const scratch: number[] = [];
const median = (values: readonly number[]) => {
  scratch.length = values.length;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i] ?? 0;
    let at = i;
    while (at > 0 && (scratch[at - 1] ?? 0) > value) {
      scratch[at] = scratch[at - 1] ?? 0;
      at -= 1;
    }
    scratch[at] = value;
  }
  return scratch[Math.floor(values.length / 2)] ?? 0;
};

const cutoffFor = (hz: number) =>
  Math.min(TRACKER.searchCutoffHz, Math.max(TRACKER.minCutoffHz, TRACKER.lockedCutoffFactor * hz));

const spreadCents = (values: readonly number[]) =>
  (Math.max(...values) - Math.min(...values)) * 100;

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
  let glitches = 0;
  let clean = 0;
  // Running clarity of the frames the lock has taken; the glitch gate measures a dip against it.
  let clarityAvg = 0;
  let cutoffHz: number = TRACKER.searchCutoffHz;
  // The time (ms) the window is clear of the cutoff change; 0 when none is pending.
  let settleUntilMs = 0;
  // Frames since the cutoff closed in are in the history until the window has left the change.
  let dirty = false;
  // After the dirty phase: 'waiting' for the settle deadline, 'filling' the history from it until
  // it holds `settledFrames`; no reading shows meanwhile.
  let refill: 'none' | 'waiting' | 'filling' = 'none';
  let settleFrames = options.settleFrames ?? settleFramesFor(43);

  /** Hops of settle time still to run at `timeMs`. */
  const settlingAt = (timeMs: number) =>
    Math.max(0, Math.ceil((settleUntilMs - timeMs) / TRACKER.hopMs));

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
    settleUntilMs = 0;
    dirty = false;
    refill = 'none';
    glitches = 0;
    clean = 0;
  };

  /** Starts a lock on `midi`'s note, hidden until the new cutoff has had its effect. */
  const begin = (
    frames: number[],
    rmsValue: number,
    hz: number,
    clarity: number,
    timeMs: number,
  ) => {
    history = frames;
    peakRms = rmsValue;
    away = [];
    pending = undefined;
    streak = 0;
    inTune = false;
    lastReading = undefined;
    glitches = 0;
    clean = 0;
    clarityAvg = clarity;
    const target = cutoffFor(hz);
    // Only a cutoff that closes in leaves sharp frames behind; one that opens does not.
    dirty = target < 0.85 * cutoffHz;
    refill = 'none';
    settleUntilMs = dirty ? timeMs + settleFrames * TRACKER.hopMs : 0;
    cutoffHz = target;
  };

  const emit = (midi: number): Reading => {
    const cents = Math.abs(midi - Math.round(midi)) * 100;
    if (cents <= TRACKER.inTuneCents) streak += 1;
    else streak = 0;
    if (inTune) inTune = cents <= TRACKER.outOfTuneCents;
    else inTune = streak >= TRACKER.inTuneReadings;
    const hz = referenceHz * 2 ** ((midi - 69) / 12);
    cutoffHz = cutoffFor(hz);
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

    /** The window changed size, so the time a cutoff change needs to clear it did too. */
    setSettleFrames(frames: number) {
      settleFrames = frames;
    },

    /**
     * `timeMs` is the audio clock, which the settle runs on. `wallMs` times the hold, so a
     * context that stops rendering still lets it expire; it is `timeMs` when not given.
     */
    push(
      detection: PitchDetection | undefined,
      rmsValue: number,
      timeMs: number,
      wallMs: number = timeMs,
    ): TrackerStep {
      // The clock, not the count of pushes, is what moves the window past the change: ticks that
      // arrive late or in a burst read the same window and must not count as elapsed time.
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
          if (wallMs - lastAcceptedMs > TRACKER.holdMs) {
            unlock();
            return { reading: undefined, cutoffHz };
          }
          return { reading: lastReading && { ...lastReading, held: true }, cutoffHz };
        }
        return { reading: undefined, cutoffHz };
      }

      // The frame right after a rejected one is a new pluck, not a dropout: its attack is no glitch.
      const afterReject = rejects > 0;
      rejects = 0;
      lastAcceptedMs = wallMs;

      // The jump is from the last frame the history took, not the median, which trails a moving
      // pitch by a couple of hops: a peg turn is then never a jump, a dropout still is.
      const jump = centsBetween(midi, history.at(-1) ?? centre ?? midi);
      const suspect =
        locked &&
        near &&
        !dirty &&
        !afterReject &&
        centsBetween(midi, centre) > TRACKER.glitchCents &&
        detection.clarity <
          clarityAvg -
            (jump > TRACKER.bigGlitchCents
              ? TRACKER.bigGlitchClarityDip
              : TRACKER.glitchClarityDip);
      if (suspect && glitches < TRACKER.glitchFrames) {
        glitches += 1;
        clean = 0;
        // The same reading, not a held one: the display freezes without dimming.
        return { reading: lastReading, cutoffHz };
      }
      if (!suspect) {
        clean += 1;
        if (clean >= TRACKER.cleanFrames) glitches = 0;
      } else {
        clean = 0;
      }
      if (locked) clarityAvg += TRACKER.clarityAverage * (detection.clarity - clarityAvg);

      if (!locked) {
        if (pending !== undefined && centsBetween(pending, midi) <= TRACKER.lockWithinCents) {
          locked = true;
          begin([pending, midi], rmsValue, detection.hz, detection.clarity, timeMs);
          return { reading: dirty ? undefined : emit(median(history)), cutoffHz };
        }
        pending = midi;
        return { reading: undefined, cutoffHz };
      }

      if (near) {
        away = [];
        // A string plucked again inside the hold finds the cutoff opened by the silence; closing
        // it again is the same step a fresh lock hides, so the frames taken through the old
        // cutoff are dropped and the reading waits, held, until the window is clear.
        if (!dirty && cutoffFor(detection.hz) < 0.85 * cutoffHz) {
          settleUntilMs = timeMs + settleFrames * TRACKER.hopMs;
          dirty = true;
          cutoffHz = cutoffFor(detection.hz);
          // The history stays, as in the refill below: it is the centre `near` is judged against,
          // and emptying it here made an attack frame the centre, so the real pitch read as away
          // and re-locked (#332). It is emptied at the settle deadline.
        }
        if (dirty && settlingAt(timeMs) <= 2) {
          // The frames from here on went through the new cutoff alone.
          dirty = false;
          refill = 'waiting';
        }
        // Frames before the deadline are not taken, however many ticks arrive: dense ticks would
        // fill the median inside the disturbance, and long render quanta re-read one window. The
        // history stays meanwhile, as the centre `near` is judged against.
        if (refill === 'waiting') {
          if (timeMs < settleUntilMs)
            return { reading: lastReading && { ...lastReading, held: true }, cutoffHz };
          history = [];
          refill = 'filling';
        }
        history.push(midi);
        if (history.length > TRACKER.median) history.shift();
        peakRms = Math.max(peakRms, rmsValue);
        // Frames a hop apart share most of their samples, so a splice in the input (dropped
        // samples, #433) biases several in a row and a median of three can be mostly bad: the
        // first reading waits until they agree, or until the history is a full median. At the 4096
        // window a splice spans most of five frames and this does not help; see the README.
        if (
          refill === 'filling' &&
          history.length >= TRACKER.settledFrames &&
          (history.length >= TRACKER.median || spreadCents(history) <= TRACKER.glitchCents)
        )
          refill = 'none';
        if (dirty || refill !== 'none')
          return { reading: lastReading && { ...lastReading, held: true }, cutoffHz };
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
        begin(away, rmsValue, detection.hz, detection.clarity, timeMs);
        return { reading: dirty ? undefined : emit(median(history)), cutoffHz };
      }
      return { reading: lastReading, cutoffHz };
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
