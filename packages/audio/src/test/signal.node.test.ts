import { describe, expect, it } from 'vitest';

import {
  BANDS_PER_OCTAVE,
  LOWEST_BAND,
  attackRatios,
  bandEnergy,
  bandsOfBins,
  cents,
  detectOnsets,
  peak,
  pitchAt,
  rms,
  spectralFlux,
  toneLevel,
  zeroCrossingFrequency,
} from './signal';
import type { Signal } from './signal';
import { ATTACK_THRESHOLDS } from './real-file';

const RATE = 44_100;

function synth(seconds: number, sample: (time: number) => number): Signal {
  const data = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < data.length; i += 1) data[i] = sample(i / RATE);
  return { data, sampleRate: RATE };
}

const sine =
  (frequency: number, amplitude = 1) =>
  (time: number) =>
    amplitude * Math.sin(2 * Math.PI * frequency * time);

/** A weak fundamental under louder harmonics, as a low guitar string has. */
const HARMONICS = [0.2, 1, 0.6, 0.4, 0.2];
const harmonic = (frequency: number) => (time: number) => {
  let sum = 0;
  for (const [index, level] of HARMONICS.entries()) {
    sum += level * Math.sin(2 * Math.PI * (index + 1) * frequency * time);
  }
  return 0.3 * sum;
};

/** A deterministic white noise, uniform in -1..1. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;
    return (state / 2 ** 32) * 2 - 1;
  };
}

/** Plucks of a sine at `times`, each decaying with time constant `decay`; they overlap. */
function plucks(times: readonly number[], frequency: number, decay: number): (t: number) => number {
  return (time) => {
    let sum = 0;
    for (const start of times) {
      if (time >= start) sum += 0.5 * Math.exp(-(time - start) / decay) * sine(frequency)(time);
    }
    return sum;
  };
}

describe('level', () => {
  it('reads a sine of amplitude a as rms a/√2 and peak a', () => {
    const signal = synth(0.5, sine(440, 0.5));
    expect(rms(signal, 0, 0.5)).toBeCloseTo(0.5 / Math.SQRT2, 4);
    expect(peak(signal, 0, 0.5)).toBeCloseTo(0.5, 3);
    expect(toneLevel(signal, 440, 0, 0.5)).toBeCloseTo(0.5, 3);
  });

  it('clamps spans to the signal', () => {
    const signal = synth(0.1, sine(440));
    expect(rms(signal, -1, 10)).toBeCloseTo(rms(signal, 0, 0.1), 9);
    expect(rms(signal, 5, 6)).toBe(0);
  });
});

describe('detectOnsets', () => {
  const GRID = [0.1, 0.35, 0.6, 0.85];

  it('finds sounds after silence on the sample', () => {
    const signal = synth(1.2, (time) =>
      GRID.some((start) => time >= start && time < start + 0.1) ? sine(440)(time + 0.25 / 440) : 0,
    );
    const found = detectOnsets(signal);
    expect(found).toHaveLength(GRID.length);
    for (const [index, at] of found.entries()) expect(at).toBeCloseTo(GRID[index] ?? 0, 4);
  });

  it('ignores a re-attack over a sounding note unless asked', () => {
    const signal = synth(1.2, plucks(GRID, 220, 0.4));
    expect(detectOnsets(signal)).toHaveLength(1);
    const found = detectOnsets(signal, { rise: 1.5 });
    expect(found).toHaveLength(GRID.length);
    for (const [index, at] of found.entries()) {
      expect(Math.abs(at - (GRID[index] ?? 0))).toBeLessThan(0.002);
    }
  });

  it.each([0.03, 1])('sets its floor by the peak, here %f', (amplitude) => {
    // A filtered attack, slow to leave silence, and tails 60 dB down when the next note starts.
    const envelope = (time: number): number => {
      const start = GRID.filter((at) => at <= time).at(-1);
      if (start === undefined) return 0;
      const since = time - start;
      if (since < 0.02) return (since / 0.02) ** 2;
      return since < 0.1 ? 1 : 10 ** ((-60 * (since - 0.1)) / 0.15 / 20);
    };
    const signal = synth(1.2, (time) => amplitude * envelope(time) * sine(1000)(time));
    const found = detectOnsets(signal);
    expect(found).toHaveLength(GRID.length);
    for (const [index, at] of found.entries()) {
      const late = at - (GRID[index] ?? 0);
      expect(late).toBeGreaterThanOrEqual(0);
      expect(late).toBeLessThan(0.002);
    }
  });

  it('reports one onset for a slow attack, not one per hop', () => {
    const signal = synth(0.5, (time) => Math.min(1, time / 0.02) * sine(330)(time));
    expect(detectOnsets(signal, { rise: 2 })).toHaveLength(1);
  });
});

describe('pitchAt', () => {
  it.each([41.2, 82.41, 110, 440, 1318.5])('finds a %f Hz sine within a cent', (frequency) => {
    const signal = synth(0.2, sine(frequency, 0.3));
    const found = pitchAt(signal, 0.02, { window: 0.1 });
    expect(Math.abs(cents(found ?? 0, frequency))).toBeLessThan(1);
  });

  it('finds the fundamental of a harmonic-rich tone, where zero crossings are fooled', () => {
    const signal = synth(0.2, harmonic(110));
    expect(Math.abs(cents(pitchAt(signal, 0.02) ?? 0, 110))).toBeLessThan(1);
    expect(Math.abs(cents(zeroCrossingFrequency(signal, 0.02, 0.12), 110))).toBeGreaterThan(50);
  });

  it('reads the pitch at the time asked, across a change', () => {
    const signal = synth(0.4, (time) => (time < 0.2 ? sine(220)(time) : sine(330)(time)));
    expect(Math.abs(cents(pitchAt(signal, 0.05) ?? 0, 220))).toBeLessThan(1);
    expect(Math.abs(cents(pitchAt(signal, 0.25) ?? 0, 330))).toBeLessThan(1);
  });

  it('is undefined on silence and noise', () => {
    expect(
      pitchAt(
        synth(0.2, () => 0),
        0,
      ),
    ).toBeUndefined();
    const random = noise(7);
    expect(pitchAt(synth(0.2, random), 0)).toBeUndefined();
  });
});

describe('bandEnergy', () => {
  it('reads a sine inside the band as its rms and outside it as nothing', () => {
    const signal = synth(0.25, sine(1000, 0.5));
    expect(bandEnergy(signal, 500, 2000, 0, 0.25)).toBeCloseTo(0.5 / Math.SQRT2, 2);
    expect(bandEnergy(signal, 2500, 10_000, 0, 0.25)).toBeLessThan(1e-3);
  });

  it('splits two tones by band', () => {
    const signal = synth(0.25, (time) => sine(200, 0.4)(time) + sine(5000, 0.1)(time));
    expect(bandEnergy(signal, 20, 1000, 0, 0.25)).toBeCloseTo(0.4 / Math.SQRT2, 2);
    expect(bandEnergy(signal, 2000, 20_000, 0, 0.25)).toBeCloseTo(0.1 / Math.SQRT2, 2);
  });

  it('shares white noise in proportion to bandwidth', () => {
    const signal = synth(1, noise(11));
    const total = bandEnergy(signal, 0, RATE / 2, 0, 1);
    expect(total).toBeCloseTo(rms(signal, 0, 1), 2);
    const lower = bandEnergy(signal, 0, RATE / 4, 0, 1) ** 2;
    const upper = bandEnergy(signal, RATE / 4, RATE / 2, 0, 1) ** 2;
    expect(lower / upper).toBeCloseTo(1, 1);
  });
});

describe('spectralFlux and attackRatios', () => {
  const struck = (period: number, frequency: number) => (time: number) =>
    Math.exp(-12 * (time % period)) * Math.sin(2 * Math.PI * frequency * time);

  it('hears a note struck again at the same pitch', () => {
    const signal = synth(3, struck(0.25, 330));
    const attacks = Array.from({ length: 11 }, (_, k) => 0.25 * (k + 1));
    const ratios = attackRatios(spectralFlux(signal), attacks);
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(5);
  });

  it('does not hear fake attack times in one held tone', () => {
    // Every render has a noise floor; over digital stillness the ratio is noise over noise. The
    // band flux of a stationary signal still wanders (1.1 to 1.95 over seeds and levels), so
    // the bound is `heard`, the line a sustain must stay under, not `missed`.
    const hiss = noise(7);
    const signal = synth(3, (time) => sine(330, 0.5)(time) + 0.001 * hiss());
    const ratios = attackRatios(spectralFlux(signal), [0.6, 1.2, 1.8, 2.4]);
    for (const ratio of ratios) expect(ratio).toBeLessThan(ATTACK_THRESHOLDS.heard);
  });

  it('hears a third tone entering under two that keep ringing', () => {
    const signal = synth(
      3,
      (time) =>
        0.3 * Math.sin(2 * Math.PI * 220 * time) +
        0.3 * Math.sin(2 * Math.PI * 277 * time) +
        (time >= 1.5 ? 0.3 * Math.exp(-3 * (time - 1.5)) * Math.sin(2 * Math.PI * 659 * time) : 0),
    );
    const [ratio] = attackRatios(spectralFlux(signal), [1.5]);
    expect(ratio).toBeGreaterThanOrEqual(1.5);
  });

  /** Partials of `base` Hz up to `top` Hz at 1/n, each decaying at `decay` per second from `start`. */
  const pluck =
    (start: number, base: number, top: number, decay: number, level = 0.3) =>
    (time: number) => {
      if (time < start) return 0;
      let sum = 0;
      for (let n = 1; n * base <= top; n += 1) sum += Math.sin(2 * Math.PI * n * base * time) / n;
      return level * Math.exp(-decay * (time - start)) * sum;
    };

  // 1.5 s worst on CI (#384): own timeout, 4x the worst rounded up to 30 s.
  it(
    'hears lowpassed chugs and their re-strikes between bright notes, as a palm-muted riff has',
    { timeout: 30_000 },
    () => {
      // Every 0.3 s a bright note decaying across hundreds of bins above 3 kHz, then two chugs
      // below 900 Hz on the same pitch. The linear-bin flux read the first chug of each pair at
      // 1.16 to 1.29, weak or missed and never heard: the bright note's fall hid the chug's few bins.
      const hiss = noise(3);
      const sounds: ((time: number) => number)[] = [];
      const attacks: number[] = [];
      for (let k = 0; k < 8; k += 1) {
        sounds.push(
          pluck(0.2 + 0.3 * k, 330, 10_000, 2, 0.6),
          pluck(0.35 + 0.3 * k, 110, 880, 14, 0.06),
          pluck(0.425 + 0.3 * k, 110, 880, 14, 0.06),
        );
        if (k > 0) attacks.push(0.35 + 0.3 * k, 0.425 + 0.3 * k);
      }
      const signal = synth(3, (time) => {
        let sum = 0.001 * hiss();
        for (const sound of sounds) sum += sound(time);
        return sum;
      });
      const ratios = attackRatios(spectralFlux(signal), attacks);
      for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(ATTACK_THRESHOLDS.heard);
    },
  );

  it('reads a decaying tone with a fake attack in its release as missed, by the floor', () => {
    const decaying = pluck(0.3, 330, 6000, 6, 0.4);
    const rest = pluck(1.3, 220, 3000, 6, 0.4);
    const signal = synth(2.4, (time) => decaying(time) + rest(time));
    // A third attack in the dead air after the second note: nothing there to hear.
    const [first, , silent] = attackRatios(spectralFlux(signal), [0.3, 1.3, 2.1]);
    expect(first).toBeGreaterThanOrEqual(ATTACK_THRESHOLDS.heard);
    expect(silent).toBeLessThan(ATTACK_THRESHOLDS.missed);
  });

  it('groups bins into 6 bands an octave, each holding at least one bin', () => {
    const { bands, first, last } = bandsOfBins(1024, RATE);
    // 40 Hz to Nyquist is 9.1 octaves; the lowest bands hold no bin and are merged away.
    expect(bands).toBeGreaterThan(40);
    expect(bands).toBeLessThanOrEqual(
      Math.ceil(BANDS_PER_OCTAVE * Math.log2(RATE / 2 / LOWEST_BAND)),
    );
    for (let band = 0; band < bands; band += 1) {
      expect(last[band] ?? -1).toBeGreaterThanOrEqual(first[band] ?? 0);
      if (band > 0) expect(first[band]).toBe((last[band - 1] ?? 0) + 1);
    }
    expect(first[0]).toBe(1);
    expect(last[bands - 1]).toBe(512);
    // Under 900 Hz a lowpassed chug has about a fifth of the weight, not the 4 % of linear bins.
    const below = first.filter((bin) => (bin * RATE) / 1024 < 900).length;
    expect(below).toBeGreaterThanOrEqual(8);
  });

  it('reads a loud attack over pure silence as heard, and a fake one beside it as missed', () => {
    const signal = synth(2, (time) => pluck(0.5, 220, 3000, 6, 0.4)(time));
    const [real, fake] = attackRatios(spectralFlux(signal), [0.5, 1.7]);
    expect(real).toBeGreaterThanOrEqual(ATTACK_THRESHOLDS.heard);
    expect(fake).toBeLessThan(ATTACK_THRESHOLDS.missed);
  });

  it('documents that a held harmonic-rich tone can read above heard at fake attack times', () => {
    // A known limit of the detector, pinned so a change to it shows: partials beating inside a
    // band make a stationary tone's flux wander, 3 to 4 at the measured seeds.
    const hiss = noise(5);
    const signal = synth(3, (time) => {
      let sum = 0;
      for (let n = 1; n * 220 < 10_000; n += 1) sum += Math.sin(2 * Math.PI * n * 220 * time) / n;
      return 0.3 * sum + 0.001 * hiss();
    });
    const ratios = attackRatios(spectralFlux(signal), [0.6, 1.2, 1.8, 2.4]);
    for (const ratio of ratios) {
      expect(ratio).toBeGreaterThan(ATTACK_THRESHOLDS.heard);
      expect(ratio).toBeLessThan(6);
    }
  });

  it('times each frame at its centre', () => {
    const flux = spectralFlux(synth(1, sine(440)), { frame: 1024, hop: 256 });
    expect(flux.times[0]).toBeCloseTo(512 / RATE, 6);
    expect(flux.times[1]).toBeCloseTo((512 + 256) / RATE, 6);
    expect(flux.values.length).toBe(Math.floor((RATE - 1024) / 256) + 1);
  });
});
