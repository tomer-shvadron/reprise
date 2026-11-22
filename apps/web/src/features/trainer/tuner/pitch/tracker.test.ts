import { describe, expect, it } from 'vitest';

import { midiFromHz } from '../notes';
import { lowpassChain, pluck, sine, simulate } from '../test-signals';
import {
  agreeFramesFor,
  createTracker,
  medianFramesFor,
  settleFramesFor,
  TRACKER,
  type Reading,
  type TrackerStep,
} from './tracker';

describe('the tracker', () => {
  const rate = 48000;
  const run = (signal: Float32Array, lowestHz = 82.41) => simulate(signal, rate, { lowestHz });
  const tone = (hz: number, seconds: number, level = 0.3) =>
    sine(hz, rate, Math.round(seconds * rate), level);
  const concat = (...parts: Float32Array[]) => {
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
    }
    return out;
  };

  it('holds the last reading for 1.5 s, then clears it', () => {
    const frames = run(concat(tone(110, 0.6), new Float32Array(rate * 2)));
    const lastLive = frames.map((f) => Boolean(f.reading && !f.reading.held)).lastIndexOf(true);
    const heldFrames = frames.slice(lastLive + 1).filter((f) => f.reading?.held);
    expect(heldFrames.length).toBeGreaterThan(60);
    const heldMs = (heldFrames.at(-1)?.timeMs ?? 0) - (frames[lastLive]?.timeMs ?? 0);
    expect(heldMs).toBeGreaterThan(1300);
    expect(heldMs).toBeLessThanOrEqual(1500);
    expect(frames.at(-1)?.reading).toBeUndefined();
    expect(frames.at(-1)?.cutoffHz).toBe(TRACKER.searchCutoffHz);
  });

  it('is in tune from 3 cents and stays so until 5', () => {
    const tracker = createTracker();
    let clock = 0;
    const push = (cents: number, n: number, rms = 0.1) => {
      // Reported frames only: the lock is hidden for a few frames while the cutoff closes in.
      let out;
      for (let i = 0; i < n; i += 1) {
        out = tracker.push(
          { hz: 110 * 2 ** (cents / 1200), clarity: 0.99 },
          rms,
          (clock += TRACKER.hopMs),
        );
      }
      return out?.reading;
    };
    // The lock is hidden for the settle frames and the frames that refill the median, then each
    // reading within 3 cents counts.
    expect(push(2, settleFramesFor(43) + 4)?.inTune).toBe(false);
    expect(push(2, 3)?.inTune).toBe(false);
    expect(push(2, 1)?.inTune).toBe(true);
    expect(push(4.5, 1)?.inTune).toBe(true);
    // The median of five frames lags, so a clear step takes a few frames to show.
    expect(push(8, 5)?.inTune).toBe(false);
    expect(push(2, 5)?.inTune).toBe(false);
    expect(push(2, 5)?.inTune).toBe(true);
  });

  it('moves the lock to a new note within four hops', () => {
    const frames = run(concat(tone(82.41, 0.8), tone(110, 0.8)));
    const boundary = 0.8 * 1000 + 20;
    const after = frames.filter((f) => f.timeMs > boundary && f.reading && !f.reading.held);
    const moved = after.findIndex((f) => Math.abs((f.reading?.hz ?? 0) - 110) < 1);
    expect(moved).toBeGreaterThanOrEqual(0);
    // The window still holds the old note for a while, so count from where the new tone fills it.
    const settled = frames.filter((f) => f.timeMs > boundary + 42.7);
    const first = settled.findIndex((f) => Math.abs((f.reading?.hz ?? 0) - 110) < 1);
    expect(first).toBeLessThanOrEqual(4);
  });

  it('keeps a new lock hidden through a burst of ticks that read the same window', () => {
    const tracker = createTracker();
    const pushAt = (timeMs: number) =>
      tracker.push({ hz: 110, clarity: 0.99 }, 0.1, timeMs).reading;
    pushAt(0);
    pushAt(20);
    // A stalled main thread catches up with many ticks at once; the window has not moved, so
    // none of them is time past the cutoff change.
    for (let i = 0; i < settleFramesFor(43) + 5; i += 1) expect(pushAt(40)).toBeUndefined();
    // Once the clock has run the window past the change, three frames later the reading shows.
    const clear = 40 + settleFramesFor(43) * TRACKER.hopMs;
    expect(pushAt(clear)).toBeUndefined();
    expect(pushAt(clear + TRACKER.hopMs)).toBeUndefined();
    expect(pushAt(clear + 2 * TRACKER.hopMs)?.held).toBe(false);
  });

  // The cutoff ramp keeps bending frames until the settle deadline, however often they are read
  // (#318): 10 ms steps fill a median of three inside the disturbance, 40 ms ones re-read a window.
  it.each([10, 20, 40])(
    'shows nothing before the settle deadline and a clean median after it, ticks %i ms apart',
    (step) => {
      const tracker = createTracker();
      const at = (timeMs: number, cents: number) =>
        tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 0.99 }, 0.1, timeMs).reading;
      at(0, 7);
      at(20, 7);
      const deadline = 20 + settleFramesFor(43) * TRACKER.hopMs;
      for (let t = 20 + step; t < deadline; t += step) expect(at(t, 12)).toBeUndefined();
      // The frames from the deadline on are clean; the first reading is their median.
      expect(at(deadline, 7)).toBeUndefined();
      expect(at(deadline + step, 7)).toBeUndefined();
      const first = at(deadline + 2 * step, 7);
      expect(first?.held).toBe(false);
      expect(Math.abs(((first?.midi ?? 0) - 45) * 100 - 7)).toBeLessThan(0.5);
    },
  );

  // #433: a few samples dropped from the input bias every frame whose window holds the splice by
  // about 5 cents at clarity 1.0, so no gate sees it. Frames a hop apart share most of their
  // samples, so when the deadline falls inside the splice the first median of three was two bad
  // frames and one good, and the meter showed the bad one.
  // #474 leaves the 2048 window as it was: the spread is judged over the whole fill, so a first
  // frame 3 cents off holds the reading back until the fifth frame, not the fourth.
  it('judges the first reading over the whole fill at the 2048 window', () => {
    const tracker = createTracker({ windowMs: 42.7 });
    const at = (timeMs: number, cents: number) =>
      tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 1 }, 0.1, timeMs).reading;
    at(0, 0);
    at(20, 0);
    const deadline = 20 + settleFramesFor(42.7) * TRACKER.hopMs;
    for (let t = 40; t < deadline; t += 20) at(t, 0);
    const shown = [3, 0, 0, 0, 0].map((cents, i) => at(deadline + i * 20, cents)?.held === false);
    expect(shown).toEqual([false, false, false, false, true]);
  });

  it('does not show a first reading whose frames disagree, but waits for a median of five', () => {
    const tracker = createTracker();
    const at = (timeMs: number, cents: number) =>
      tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 1 }, 0.1, timeMs).reading;
    at(0, 7);
    at(20, 7);
    const deadline = 20 + settleFramesFor(43) * TRACKER.hopMs;
    for (let t = 40; t < deadline; t += TRACKER.hopMs) at(t, 7);
    expect(at(deadline, 12)).toBeUndefined();
    expect(at(deadline + 20, 12)).toBeUndefined();
    // Two bad frames and a good one: not agreeing, so still nothing, instead of the bad median.
    expect(at(deadline + 40, 7)).toBeUndefined();
    expect(at(deadline + 60, 7)).toBeUndefined();
    const first = at(deadline + 80, 7);
    expect(first?.held).toBe(false);
    expect(Math.abs(((first?.midi ?? 0) - 45) * 100 - 7)).toBeLessThan(0.5);
  });

  describe('glitch gate', () => {
    const rig = () => {
      const tracker = createTracker();
      let clock = 0;
      let previous: Reading | undefined;
      const at = (cents: number, clarity: number) => {
        const reading = tracker.push(
          { hz: 110 * 2 ** (cents / 1200), clarity },
          0.1,
          (clock += TRACKER.hopMs),
        ).reading;
        const frozen = reading !== undefined && reading === previous;
        previous = reading;
        return { reading, frozen };
      };
      return at;
    };
    const lockAt = (at: ReturnType<typeof rig>, cents: number) => {
      for (let i = 0; i < settleFramesFor(43) + 8; i += 1) at(cents, 1);
    };

    it('freezes the reading, not dims it, for the frames a click left off', () => {
      const at = rig();
      lockAt(at, 7);
      // The frames a dropped sample left in the real-Web-Audio run: 10 to 13 cents, clarity ~0.89.
      for (const cents of [10.4, 12.6, 12.5, 11]) {
        const { reading, frozen } = at(cents, 0.89);
        expect(frozen).toBe(true);
        expect(reading?.held).toBe(false);
        expect(reading?.midi).toBeCloseTo(45.07, 3);
      }
      expect(at(7, 1).frozen).toBe(false);
    });

    it('freezes frames a dropout left 18 cents off at a clarity only 0.03 down (#433)', () => {
      const at = rig();
      lockAt(at, 7);
      const before = at(7, 1).reading;
      for (const cents of [26, 25.2, 25, 25.2, 25.1]) {
        const { reading, frozen } = at(cents, 0.97);
        expect(frozen).toBe(true);
        expect(reading).toBe(before);
      }
    });

    // Clarity wobbles frame to frame on a real mic; a turn of the peg must still move the meter.
    it.each([5, 6])(
      'never freezes a glide of %i cents a hop with clarity jittering by 0.03',
      (perHop) => {
        const at = rig();
        // A note whose own clarity is 0.96, as a real mic's is.
        for (let i = 0; i < settleFramesFor(43) + 8; i += 1) at(0, 0.96);
        let seed = 3;
        const jitter = () => {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          return (seed / 2 ** 32 - 0.5) * 0.06;
        };
        let previous: Reading | undefined;
        for (let i = 1; i <= 40; i += 1) {
          const { reading } = at(i * perHop, 0.96 + jitter());
          expect(reading).not.toBe(previous);
          previous = reading;
        }
      },
    );

    it('does not light the stale reading for the attack frame of a re-pluck in the hold', () => {
      const at = rig();
      lockAt(at, -20);
      const live = at(-20, 1).reading;
      expect(at(-20, 0.1).reading?.held).toBe(true);
      // The attack frame 15 cents away at a dipped clarity: a new pluck, so the gate stays out.
      const { reading, frozen } = at(-5, 0.95);
      expect(frozen).toBe(false);
      expect(reading).not.toBe(live);
    });

    it('takes a clean change of pitch over at once', () => {
      const at = rig();
      lockAt(at, 7);
      for (let i = 0; i < 10; i += 1) at(20, 0.99);
      expect(((at(20, 0.99).reading?.midi ?? 0) - 45) * 100).toBeCloseTo(20, 0);
    });

    it('releases a drift at exactly glitchFrames', () => {
      const at = rig();
      lockAt(at, 0);
      for (let i = 0; i < TRACKER.glitchFrames; i += 1) expect(at(30, 0.85).frozen).toBe(true);
      const next = at(30, 0.85);
      expect(next.frozen).toBe(false);
      expect(next.reading?.held).toBe(false);
    });

    it('does not restart the count after a single clean frame', () => {
      const at = rig();
      lockAt(at, 0);
      for (let i = 0; i < 4; i += 1) expect(at(30, 0.85).frozen).toBe(true);
      // One clean frame is not enough to count as the glitch being over.
      at(0, 1);
      for (let i = 0; i < TRACKER.glitchFrames - 4; i += 1) expect(at(30, 0.85).frozen).toBe(true);
      expect(at(30, 0.85).frozen).toBe(false);
    });

    it('restarts the count after cleanFrames clean frames in a row', () => {
      const at = rig();
      lockAt(at, 0);
      for (let i = 0; i < 4; i += 1) at(30, 0.85);
      for (let i = 0; i < TRACKER.cleanFrames; i += 1) at(0, 1);
      for (let i = 0; i < TRACKER.glitchFrames; i += 1) expect(at(30, 0.85).frozen).toBe(true);
    });

    it('never freezes or holds a weak note whose clarity is low but steady', () => {
      let seed = 7;
      const noise = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 2 ** 32 - 0.5;
      };
      // The note starts weak: its running clarity is the weak clarity, so nothing dips.
      const tracker = createTracker();
      let clock = 0;
      let previous: Reading | undefined;
      for (let i = 0; i < 120; i += 1) {
        const reading = tracker.push(
          { hz: 110 * 2 ** ((5 * noise()) / 1200), clarity: 0.91 + 0.02 * noise() },
          0.1,
          (clock += TRACKER.hopMs),
        ).reading;
        if (i >= settleFramesFor(43) + 3) {
          expect(reading?.held).toBe(false);
          expect(reading).not.toBe(previous);
        }
        previous = reading;
      }
    });
  });

  it('ignores a single frame an octave off', () => {
    const tracker = createTracker();
    let clock = 0;
    const at = (hz: number) =>
      tracker.push({ hz, clarity: 0.95 }, 0.1, (clock += TRACKER.hopMs)).reading;
    for (let i = 0; i < settleFramesFor(43) + 5; i += 1) at(110);
    expect(at(220)?.hz).toBeCloseTo(110, 3);
    expect(at(110)?.hz).toBeCloseTo(110, 3);
    at(220);
    at(220);
    expect(at(220)?.hz).toBeCloseTo(220, 3);
  });

  it('lowers the cutoff to 2.5 times the locked note and opens it again after silence', () => {
    const frames = run(concat(tone(110, 0.6), new Float32Array(rate)));
    expect(frames.some((f) => Math.abs(f.cutoffHz - 275) < 2)).toBe(true);
    expect(frames.at(-1)?.cutoffHz).toBe(1500);
  });

  it('gates a decaying tail 30 dB below the peak', () => {
    const decaying = tone(110, 3, 0.3).map((v, i) => v * Math.exp(-i / rate / 0.25));
    const frames = run(decaying);
    const live = frames.filter((f) => f.reading && !f.reading.held);
    expect(live.length).toBeGreaterThan(5);
    expect(live.length).toBeLessThan(frames.length - 20);
  });

  it('passes a tone below the cutoff at its full level through the two sections', () => {
    const out = lowpassChain(tone(110, 0.5), rate, 1500);
    let peak = 0;
    for (let i = out.length - 2000; i < out.length; i += 1) {
      peak = Math.max(peak, Math.abs(out[i] ?? 0));
    }
    expect(peak).toBeGreaterThan(0.3 * 0.99);
    expect(peak).toBeLessThan(0.3 * 1.01);
  });

  it('drops the frames taken through the old cutoff when a string is plucked again in the hold', () => {
    const tracker = createTracker();
    const at = (cents: number, rms = 0.1, timeMs = 0) =>
      tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 0.99 }, rms, timeMs);
    const settle = settleFramesFor(43);
    for (let i = 0; i < settle + 8; i += 1) at(0, 0.1, i * 20);
    // The string dies away: the cutoff opens, the last reading is held.
    let step;
    for (let i = 0; i < TRACKER.openAfterRejects + 2; i += 1) {
      step = tracker.push(undefined, 0, 400 + i * 20);
    }
    expect(step?.cutoffHz).toBe(TRACKER.searchCutoffHz);
    expect(step?.reading?.held).toBe(true);
    // Plucked again: the frames through the open cutoff read 16 cents sharp, then the new
    // cutoff has its effect. None of the sharp ones may reach a live reading.
    const live: number[] = [];
    for (let i = 0; i < settle + 6; i += 1) {
      const result = at(i < settle - 2 ? 16 : 0, 0.1, 600 + i * 20);
      if (result.reading && !result.reading.held) live.push((result.reading.midi - 45) * 100);
    }
    expect(live.length).toBeGreaterThan(3);
    for (const cents of live) expect(Math.abs(cents)).toBeLessThan(3);
    expect(Math.abs(at(0, 0.1, 1200).cutoffHz - 275)).toBeLessThan(1);
  });

  describe('a re-pluck inside the hold (#332)', () => {
    const start = () => {
      const tracker = createTracker();
      const at = (cents: number, timeMs: number) =>
        tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 0.99 }, 0.1, timeMs);
      const settle = settleFramesFor(43);
      for (let i = 0; i < settle + 8; i += 1) at(0, i * 20);
      for (let i = 0; i < TRACKER.openAfterRejects + 2; i += 1)
        tracker.push(undefined, 0, 400 + i * 20);
      return { at, settle };
    };
    // An attack frame, then the body of the note; the cents are from the note held before.
    const rePluck = (attack: number, body: number) => {
      const { at, settle } = start();
      const out = [at(attack, 600)];
      for (let i = 1; i < settle + 6; i += 1) out.push(at(body, 600 + i * 20));
      return { out, settle };
    };
    const centsOf = (step?: TrackerStep) => ((step?.reading?.midi ?? 0) - 45) * 100;

    it('continues the reading when the attack frame sits on the other side of the note', () => {
      // Each frame is near the old centre but 60 cents from the other, so a history emptied by
      // the re-pluck would call the second away.
      const { out, settle } = rePluck(-30, 30);
      // The note continues: held readings until the cutoff change has cleared the window. A
      // re-lock on the attack frame's centre would light a fresh live reading at once.
      expect(out.every((s) => s.reading !== undefined)).toBe(true);
      expect(out.slice(0, settle - 3).every((s) => s.reading?.held === true)).toBe(true);
      expect(Math.abs(centsOf(out.at(-1)) - 30)).toBeLessThan(1);
    });

    it.each([
      [45, 55],
      [20, 70],
      [40, 100],
    ])('hides the frames in the cutoff change when the attack is +%i and the body +%i', (a, b) => {
      // The body is beyond `awayCents` from the old note, so the lock moves, but the settle the
      // re-pluck began is kept.
      const { out, settle } = rePluck(a, b);
      // The first frame is the attack; the away path may return the old reading unheld for the
      // two frames that follow it, before the lock moves.
      expect(out.slice(3, settle - 3).every((s) => s.reading?.held !== false)).toBe(true);
      expect(Math.abs(centsOf(out.at(-1)) - b)).toBeLessThan(1);
    });

    it('re-locks on a different pitch whose attack frame is near the old note', () => {
      const { out } = rePluck(40, 200);
      expect(Math.abs(centsOf(out.at(-1)) - 200)).toBeLessThan(1);
      expect(out.at(-1)?.reading?.held).toBe(false);
    });
  });

  it('keeps every reading within 3 cents when a string is plucked again inside the hold', () => {
    const hz = 82.41 * 2 ** (7 / 1200);
    const decayed = pluck({
      hz,
      sampleRate: rate,
      seconds: 0.9,
      inharmonicity: 3e-4,
      weakFundamental: true,
      snrDb: 30,
      seed: 4,
    }).map((v, i) => v * Math.exp(-i / rate / 0.12));
    // Pluck, let it die away well under the tail gate, and pluck again within the 1.5 s hold.
    const frames = run(concat(decayed, new Float32Array(Math.round(0.5 * rate)), decayed));
    const target = midiFromHz(hz);
    const secondOnsetMs = 1400;
    const again = frames.filter((f) => f.timeMs > secondOnsetMs && f.reading && !f.reading.held);
    expect(again.length).toBeGreaterThan(3);
    for (const { reading } of again) {
      expect(Math.abs(((reading?.midi ?? 0) - target) * 100)).toBeLessThan(3);
    }
    // The silence opened the cutoff, so the second pluck had to close it again.
    expect(frames.some((f) => f.timeMs > 1000 && f.timeMs < 1400 && f.cutoffHz === 1500)).toBe(
      true,
    );
  });

  describe('at the 4096 window (#474)', () => {
    const windowMs = 85.3;
    const settle = settleFramesFor(windowMs);
    // The cents off A2 of a live reading; clarity 1.0 is what a splice keeps.
    const setup = () => {
      const tracker = createTracker({ windowMs });
      let clock = 0;
      const at = (cents: number) =>
        tracker.push({ hz: 110 * 2 ** (cents / 1200), clarity: 1 }, 0.1, (clock += TRACKER.hopMs));
      const cents = (reading: Reading | undefined) =>
        reading && !reading.held ? (reading.midi - 45) * 100 : undefined;
      return { tracker, at, cents, now: () => clock };
    };

    it('keeps agreement within the median, for every window', () => {
      for (let w = 20; w <= 200; w += 1) {
        expect(agreeFramesFor(w)).toBeLessThanOrEqual(medianFramesFor(w));
        // The agreeing frames stay a strict majority of the median, so a sliding exit emits a
        // median inside the agreeing block.
        expect(2 * agreeFramesFor(w)).toBeGreaterThan(medianFramesFor(w));
      }
      expect(medianFramesFor(42.7)).toBe(TRACKER.median);
      expect(medianFramesFor(windowMs)).toBe(11);
      expect(agreeFramesFor(windowMs)).toBe(6);
    });

    it('is not moved by five frames of a splice in a steady note', () => {
      const { at, cents } = setup();
      for (let i = 0; i < settle + 20; i += 1) at(0);
      for (let i = 0; i < 12; i += 1) {
        const shown = cents(at(i < 5 ? 10 : 0).reading);
        expect(shown).toBeDefined();
        expect(Math.abs(shown ?? 99)).toBeLessThan(0.5);
      }
    });

    it('shows no splice at the first lock, and a reading within a median of frames', () => {
      const { at, cents, now } = setup();
      at(0);
      at(0);
      const deadline = now() + settle * TRACKER.hopMs;
      while (now() + TRACKER.hopMs < deadline) at(0);
      let firstLive = -1;
      for (let i = 0; i < 20; i += 1) {
        const shown = cents(at(i < 5 ? 10 : 0).reading);
        if (shown === undefined) continue;
        if (firstLive < 0) firstLive = i;
        expect(Math.abs(shown)).toBeLessThan(2);
      }
      expect(firstLive).toBeGreaterThanOrEqual(0);
      expect(firstLive).toBeLessThan(medianFramesFor(windowMs));
    });

    it('follows a peg turn without freezing, 5 hops behind', () => {
      const { at, cents } = setup();
      for (let i = 0; i < settle + 20; i += 1) at(0);
      let previous = 0;
      for (let i = 1; i <= 20; i += 1) {
        const shown = cents(at(6 * i).reading);
        expect(shown).toBeDefined();
        // The median of eleven stays put for the first five hops, then follows every hop.
        if (i > 6) expect(shown ?? 0).toBeGreaterThan(previous);
        expect(6 * i - (shown ?? 0)).toBeLessThanOrEqual(5 * 6 + 1);
        previous = shown ?? 0;
      }
    });

    it('goes back to a median of five when the window shrinks mid-note', () => {
      const { tracker, at, cents } = setup();
      for (let i = 0; i < settle + 20; i += 1) at(0);
      tracker.setWindow(windowMs / 2);
      let shown: number | undefined;
      for (let i = 0; i < 3; i += 1) shown = cents(at(20).reading);
      expect(shown).toBeCloseTo(20, 1);
    });
  });
});
