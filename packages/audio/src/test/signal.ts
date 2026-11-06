/**
 * Measurements on rendered audio, shared by every suite that listens to the engine. Pure
 * arithmetic over a `Float32Array`, so it also runs under Node (`signal.node.test.ts`).
 */

/** One channel of rendered audio. */
export interface Signal {
  data: Float32Array;
  sampleRate: number;
}

export function signalOf(buffer: AudioBuffer, channel = 0): Signal {
  return { data: buffer.getChannelData(channel), sampleRate: buffer.sampleRate };
}

function frame(signal: Signal, seconds: number): number {
  return Math.min(signal.data.length, Math.max(0, Math.round(seconds * signal.sampleRate)));
}

function slice(signal: Signal, from: number, to: number): Float32Array {
  return signal.data.subarray(frame(signal, from), frame(signal, to));
}

export function cents(measured: number, expected: number): number {
  return 1200 * Math.log2(measured / expected);
}

export function rms(signal: Signal, from: number, to: number): number {
  const window = slice(signal, from, to);
  let sum = 0;
  for (const value of window) sum += value * value;
  return Math.sqrt(sum / Math.max(1, window.length));
}

export function peak(signal: Signal, from: number, to: number): number {
  let max = 0;
  for (const value of slice(signal, from, to)) max = Math.max(max, Math.abs(value));
  return max;
}

/** Mean frequency from interpolated rising zero crossings: exact on a pure tone, nothing more. */
export function zeroCrossingFrequency(signal: Signal, from: number, to: number): number {
  const window = slice(signal, from, to);
  let first: number | undefined;
  let last = 0;
  let crossings = 0;
  for (let i = 1; i < window.length; i += 1) {
    const before = window[i - 1] ?? 0;
    const after = window[i] ?? 0;
    if (before < 0 && after >= 0) {
      const at = i - 1 + before / (before - after);
      first ??= at;
      last = at;
      crossings += 1;
    }
  }
  if (first === undefined || crossings < 2) return 0;
  return ((crossings - 1) * signal.sampleRate) / (last - first);
}

/** Amplitude of one frequency in a Hann-windowed span (Goertzel), 1 for a full-scale sine. */
export function toneLevel(signal: Signal, frequency: number, from: number, to: number): number {
  const window = slice(signal, from, to);
  const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / signal.sampleRate);
  let previous = 0;
  let beforePrevious = 0;
  let weights = 0;
  for (const [index, value] of window.entries()) {
    const weight = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (window.length - 1));
    weights += weight;
    const current = value * weight + coefficient * previous - beforePrevious;
    beforePrevious = previous;
    previous = current;
  }
  const power =
    previous * previous + beforePrevious * beforePrevious - coefficient * previous * beforePrevious;
  return (2 * Math.sqrt(Math.max(0, power))) / Math.max(1, weights);
}

export interface OnsetOptions {
  /**
   * Level a sample must exceed to count as sound; `FLOOR_DB` under the signal's peak by default,
   * so a quiet render's attacks and a loud one's release tails both land on the right side of it.
   */
  floor?: number;
  /** Seconds below `floor` that make the next sound an onset. */
  gap?: number;
  /**
   * Also report a re-attack over a sounding note: the first difference's envelope jumping by this
   * factor over its maximum in the preceding `lookback` (2 is +6 dB). Off by default.
   */
  rise?: number;
  lookback?: number;
  /** Seconds after an onset in which no other is reported. */
  refractory?: number;
}

/** The default floor relative to the peak: a filtered attack crosses it within a millisecond. */
export const FLOOR_DB = -50;

/** Envelope hop: 32 frames is 0.7 ms at 44.1 kHz, the resolution of a re-attack. */
const HOP = 32;
/** The longest attack ramp a re-attack is recognised across. */
const ATTACK = 0.005;

function silenceOnsets(signal: Signal, floor: number, gap: number): number[] {
  const found: number[] = [];
  let quiet = Number.POSITIVE_INFINITY;
  for (const [index, sample] of signal.data.entries()) {
    if (Math.abs(sample) > floor) {
      if (quiet > gap * signal.sampleRate) found.push(index / signal.sampleRate);
      quiet = 0;
    } else {
      quiet += 1;
    }
  }
  return found;
}

/** The peak of `at` over each hop. */
function envelope(length: number, at: (i: number) => number): Float32Array {
  const hops = Math.ceil(length / HOP);
  const result = new Float32Array(hops);
  for (let hop = 0; hop < hops; hop += 1) {
    let max = 0;
    for (let i = hop * HOP; i < Math.min(length, (hop + 1) * HOP); i += 1) {
      max = Math.max(max, Math.abs(at(i)));
    }
    result[hop] = max;
  }
  return result;
}

/**
 * Re-attacks, read off the first difference: a pick or a hammer is a burst of high
 * frequencies, while a note already ringing changes slowly, whatever its pitch.
 */
function riseOnsets(signal: Signal, floor: number, rise: number, lookback: number): number[] {
  const { data, sampleRate } = signal;
  const difference = (i: number): number => (i === 0 ? 0 : (data[i] ?? 0) - (data[i - 1] ?? 0));
  const level = envelope(data.length, (i) => data[i] ?? 0);
  const change = envelope(data.length, difference);
  const span = Math.max(1, Math.round((lookback * sampleRate) / HOP));
  // Compared with the level before the attack began, so a ramp of a few milliseconds still counts.
  const skip = Math.round((ATTACK * sampleRate) / HOP);
  const found: number[] = [];
  for (let hop = 0; hop < change.length; hop += 1) {
    if ((level[hop] ?? 0) <= floor) continue;
    let before = 0;
    for (let back = Math.max(0, hop - skip - span); back < hop - skip; back += 1) {
      before = Math.max(before, change[back] ?? 0);
    }
    const threshold = rise * before;
    if ((change[hop] ?? 0) <= threshold) continue;
    let at = hop * HOP;
    while (Math.abs(difference(at)) <= threshold) at += 1;
    found.push(at / sampleRate);
  }
  return found;
}

/**
 * Seconds at which a sound starts. By default a sound after at least `gap` of silence; with
 * `rise`, also a re-attack over a note still sounding, which a real instrument's tail needs.
 */
export function detectOnsets(signal: Signal, options: OnsetOptions = {}): number[] {
  const { gap = 0.01, rise, lookback = 0.02, refractory = 0.03 } = options;
  const floor = options.floor ?? peak(signal, 0, Number.POSITIVE_INFINITY) * 10 ** (FLOOR_DB / 20);
  const candidates =
    rise === undefined
      ? silenceOnsets(signal, floor, gap)
      : [...silenceOnsets(signal, floor, gap), ...riseOnsets(signal, floor, rise, lookback)].sort(
          (a, b) => a - b,
        );
  const onsets: number[] = [];
  for (const at of candidates) {
    const last = onsets.at(-1);
    if (rise === undefined || last === undefined || at - last >= refractory) onsets.push(at);
  }
  return onsets;
}

export interface PitchOptions {
  /** Seconds analysed from `time`; at least two periods of the lowest pitch sought. */
  window?: number;
  /** Lowest and highest fundamental sought, in Hz. */
  min?: number;
  max?: number;
  /** YIN's aperiodicity threshold: lower is stricter. */
  threshold?: number;
}

/**
 * The fundamental in Hz of the span starting at `time`, by YIN (de Cheveigné and Kawahara, 2002):
 * the lag where the cumulative mean normalised difference first dips under `threshold`, refined
 * by a parabola. Holds on sampled instruments, whose harmonics fool a zero-crossing count.
 * `undefined` where nothing is periodic: silence, noise, a chord.
 */
export function pitchAt(
  signal: Signal,
  time: number,
  options: PitchOptions = {},
): number | undefined {
  const { window = 0.06, min = 40, max = 2000, threshold = 0.15 } = options;
  const { sampleRate } = signal;
  const data = slice(signal, time, time + window);
  const maxLag = Math.min(Math.floor(sampleRate / min), Math.floor(data.length / 2));
  const minLag = Math.max(2, Math.floor(sampleRate / max));
  if (maxLag <= minLag) return undefined;
  const span = data.length - maxLag;
  const normalised = new Float64Array(maxLag + 1);
  normalised[0] = 1;
  let running = 0;
  for (let lag = 1; lag <= maxLag; lag += 1) {
    let sum = 0;
    for (let i = 0; i < span; i += 1) {
      const delta = (data[i] ?? 0) - (data[i + lag] ?? 0);
      sum += delta * delta;
    }
    running += sum;
    normalised[lag] = running === 0 ? 1 : (sum * lag) / running;
  }
  let lag = minLag;
  while (lag < maxLag && (normalised[lag] ?? 1) >= threshold) lag += 1;
  if (lag >= maxLag) return undefined;
  while (lag + 1 < maxLag && (normalised[lag + 1] ?? 1) < (normalised[lag] ?? 1)) lag += 1;
  const before = normalised[lag - 1] ?? 1;
  const at = normalised[lag] ?? 1;
  const after = normalised[lag + 1] ?? 1;
  const curvature = before - 2 * at + after;
  const refined = curvature > 0 ? lag + (before - after) / (2 * curvature) : lag;
  return sampleRate / refined;
}

/** In-place radix-2 FFT; `re.length` is a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0];
      [im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < size / 2; k += 1) {
        const cos = Math.cos(angle * k);
        const sin = Math.sin(angle * k);
        const a = start + k;
        const b = a + size / 2;
        const tr = (re[b] ?? 0) * cos - (im[b] ?? 0) * sin;
        const ti = (re[b] ?? 0) * sin + (im[b] ?? 0) * cos;
        re[b] = (re[a] ?? 0) - tr;
        im[b] = (im[a] ?? 0) - ti;
        re[a] = (re[a] ?? 0) + tr;
        im[a] = (im[a] ?? 0) + ti;
      }
    }
  }
}

/**
 * RMS of the part of the span between `low` and `high` Hz, from a Hann-windowed FFT by
 * Parseval: a sine of amplitude `a` inside the band reads `a / √2`, the same as `rms` of it.
 */
export function bandEnergy(
  signal: Signal,
  low: number,
  high: number,
  from: number,
  to: number,
): number {
  const window = slice(signal, from, to);
  if (window.length < 2) return 0;
  let size = 1;
  while (size < window.length) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let weights = 0;
  for (const [index, value] of window.entries()) {
    const weight = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (window.length - 1));
    weights += weight * weight;
    re[index] = value * weight;
  }
  fft(re, im);
  const resolution = signal.sampleRate / size;
  let power = 0;
  for (let bin = 1; bin < size / 2; bin += 1) {
    const frequency = bin * resolution;
    if (frequency < low || frequency > high) continue;
    power += (re[bin] ?? 0) ** 2 + (im[bin] ?? 0) ** 2;
  }
  return Math.sqrt((2 * power) / (size * weights));
}
