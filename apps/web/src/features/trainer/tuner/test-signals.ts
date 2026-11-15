import { detectPitch, rms } from './pitch/mpm';
import { createTracker, type Reading, type TrackerOptions } from './pitch/tracker';
import { windowFor } from './strings';

/** Test-only signal generators and the pipeline emulation; nothing in the app imports this. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(random: () => number): number {
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

export const centsToRatio = (cents: number) => 2 ** (cents / 1200);

export function sine(
  hz: number,
  sampleRate: number,
  length: number,
  amplitude = 0.5,
): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1)
    out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
  return out;
}

export function whiteNoise(length: number, seed: number, amplitude = 0.3): Float32Array {
  const random = mulberry32(seed);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) out[i] = amplitude * (random() * 2 - 1);
  return out;
}

export interface PluckOptions {
  hz: number;
  sampleRate: number;
  seconds: number;
  harmonics?: number;
  /** Stiffness: partial `n` sits at `n·f·√(1 + B·n²)`. */
  inharmonicity?: number;
  /** A fundamental at 0.15 of the second partial, as on a small speaker or a thin string. */
  weakFundamental?: boolean;
  /** Signal to white noise, in dB of RMS over the whole tone; none when omitted. */
  snrDb?: number;
  seed?: number;
}

/**
 * A plucked string: partials that fall off as 1/n and decay faster the higher they are, a 10 ms
 * burst of noise at the attack, and white noise at the requested level over the whole tone.
 */
export function pluck(options: PluckOptions): Float32Array {
  const { hz, sampleRate, seconds, harmonics = 15, inharmonicity = 0, snrDb } = options;
  const random = mulberry32(options.seed ?? 1);
  const length = Math.round(seconds * sampleRate);
  const signal = new Float64Array(length);
  const phases = Array.from({ length: harmonics }, () => random() * 2 * Math.PI);
  for (let n = 1; n <= harmonics; n += 1) {
    const f = n * hz * Math.sqrt(1 + inharmonicity * n * n);
    if (f > sampleRate / 2.2) break;
    let amplitude = 1 / n;
    if (n === 1 && options.weakFundamental) amplitude = 0.15 * 0.5;
    const decay = 0.6 + 0.5 * n;
    const phase = phases[n - 1] ?? 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / sampleRate;
      signal[i] =
        (signal[i] ?? 0) + amplitude * Math.exp(-decay * t) * Math.sin(2 * Math.PI * f * t + phase);
    }
  }
  const burst = Math.round(0.01 * sampleRate);
  for (let i = 0; i < burst; i += 1) {
    signal[i] = (signal[i] ?? 0) + 0.8 * (1 - i / burst) * gaussian(random);
  }
  let peak = 0;
  for (const v of signal) peak = Math.max(peak, Math.abs(v));
  const out = new Float32Array(length);
  const scale = 0.4 / (peak || 1);
  let power = 0;
  for (let i = 0; i < length; i += 1) power += ((signal[i] ?? 0) * scale) ** 2;
  const signalRms = Math.sqrt(power / length);
  const noiseRms = snrDb === undefined ? 0 : signalRms / 10 ** (snrDb / 20);
  for (let i = 0; i < length; i += 1) {
    out[i] = (signal[i] ?? 0) * scale + noiseRms * gaussian(random);
  }
  return out;
}

/** A Web Audio lowpass biquad: RBJ coefficients with `Q` in dB, as the spec defines it. */
export class Lowpass {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private readonly sampleRate: number,
    cutoffHz: number,
    private readonly qDb = 20 * Math.log10(Math.SQRT1_2),
  ) {
    this.setCutoff(cutoffHz);
  }

  setCutoff(cutoffHz: number) {
    const w = (2 * Math.PI * Math.min(cutoffHz, this.sampleRate / 2 - 1)) / this.sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * 10 ** (this.qDb / 20));
    const a0 = 1 + alpha;
    this.b0 = (1 - cos) / 2 / a0;
    this.b1 = (1 - cos) / a0;
    this.b2 = this.b0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  process(input: Float32Array | Float64Array): Float64Array {
    const out = new Float64Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const x = input[i] ?? 0;
      const y =
        this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1;
      this.x1 = x;
      this.y2 = this.y1;
      this.y1 = y;
      out[i] = y;
    }
    return out;
  }
}

/** The capture graph's two cascaded lowpass sections. */
export function lowpassChain(
  signal: Float32Array,
  sampleRate: number,
  cutoffHz: number,
): Float64Array {
  const sections = [new Lowpass(sampleRate, cutoffHz), new Lowpass(sampleRate, cutoffHz)];
  let current: Float64Array = Float64Array.from(signal);
  for (const section of sections) current = section.process(current);
  return current;
}

export interface SimulatedFrame {
  timeMs: number;
  reading: Reading | undefined;
  cutoffHz: number;
}

export interface SimulateOptions extends TrackerOptions {
  /** The lowest string being tuned, which sets the window and the detector's lower limit. */
  lowestHz: number;
  hopMs?: number;
  filter?: boolean;
}

/**
 * The whole pipeline as the app runs it: the signal through two lowpass sections whose cutoff
 * the tracker steers, a window per hop, the detector, the tracker. Returns every hop.
 */
export function simulate(
  signal: Float32Array,
  sampleRate: number,
  { lowestHz, hopMs = 20, filter = true, ...trackerOptions }: SimulateOptions,
): SimulatedFrame[] {
  const size = windowFor(sampleRate, lowestHz);
  const hop = Math.round((hopMs / 1000) * sampleRate);
  const sections = [new Lowpass(sampleRate, 1500), new Lowpass(sampleRate, 1500)];
  const tracker = createTracker(trackerOptions);
  const ring = new Float32Array(size);
  const frame = new Float32Array(size);
  const frames: SimulatedFrame[] = [];
  let cutoffHz = 1500;
  let filled = 0;
  for (let start = 0; start + hop <= signal.length; start += hop) {
    let block: Float64Array = Float64Array.from(signal.subarray(start, start + hop));
    if (filter) {
      for (const section of sections) {
        section.setCutoff(cutoffHz);
        block = section.process(block);
      }
    }
    ring.copyWithin(0, hop);
    ring.set(block, size - hop);
    filled += hop;
    if (filled < size) continue;
    frame.set(ring);
    const detection = detectPitch(frame, sampleRate, {
      minHz: lowestHz * 0.84,
      maxHz: 1500,
    });
    const step = tracker.push(detection, rms(frame), ((start + hop) / sampleRate) * 1000);
    cutoffHz = step.cutoffHz;
    frames.push({ timeMs: ((start + hop) / sampleRate) * 1000, reading: step.reading, cutoffHz });
  }
  return frames;
}
