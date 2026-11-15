import { autocorrelate } from './fft';

export interface PitchDetection {
  hz: number;
  /** The normalised autocorrelation at the chosen lag, in [0, 1]: how periodic the frame is. */
  clarity: number;
}

export interface DetectOptions {
  minHz: number;
  maxHz: number;
  /** A key maximum counts when it reaches `k` times the highest one; 0.9 by default. */
  k?: number;
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (const sample of frame) sum += sample * sample;
  return frame.length === 0 ? 0 : Math.sqrt(sum / frame.length);
}

/**
 * McLeod's pitch method: the normalised square difference `n(τ) = 2r(τ) / m(τ)`, its key maxima
 * between positive zero crossings, the first one that reaches `k` times the highest, refined by
 * a parabola through its neighbours. Returns undefined for silence or when no peak qualifies.
 */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  { minHz, maxHz, k = 0.9 }: DetectOptions,
): PitchDetection | undefined {
  const n = frame.length;
  const x = new Float64Array(n);
  let mean = 0;
  for (const sample of frame) mean += sample;
  mean /= n;
  for (let i = 0; i < n; i += 1) x[i] = (frame[i] ?? 0) - mean;

  const r = autocorrelate(x);
  const r0 = r[0] ?? 0;
  if (!(r0 > 1e-12)) return undefined;

  const tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
  const tauMax = Math.min(n - 2, Math.ceil(sampleRate / minHz));
  if (tauMax <= tauMin) return undefined;

  const nsdf = new Float64Array(tauMax + 2);
  let m = 2 * r0;
  nsdf[0] = 1;
  for (let tau = 1; tau < nsdf.length; tau += 1) {
    const head = x[tau - 1] ?? 0;
    const tail = x[n - tau] ?? 0;
    m -= head * head + tail * tail;
    nsdf[tau] = m > 1e-12 ? (2 * (r[tau] ?? 0)) / m : 0;
  }

  // Key maxima: the highest point of each positive lobe, after the first negative crossing.
  const peaks: number[] = [];
  let tau = 1;
  while (tau < tauMax && (nsdf[tau] ?? 0) > 0) tau += 1;
  while (tau < tauMax) {
    while (tau < tauMax && (nsdf[tau] ?? 0) <= 0) tau += 1;
    let best = -1;
    while (tau < tauMax && (nsdf[tau] ?? 0) > 0) {
      if (best < 0 || (nsdf[tau] ?? 0) > (nsdf[best] ?? 0)) best = tau;
      tau += 1;
    }
    if (best >= tauMin) peaks.push(best);
  }
  if (peaks.length === 0) return undefined;

  let highest = 0;
  for (const peak of peaks) highest = Math.max(highest, nsdf[peak] ?? 0);
  const chosen = peaks.find((peak) => (nsdf[peak] ?? 0) >= k * highest);
  if (chosen === undefined) return undefined;

  const left = nsdf[chosen - 1] ?? 0;
  const mid = nsdf[chosen] ?? 0;
  const right = nsdf[chosen + 1] ?? 0;
  const curvature = left - 2 * mid + right;
  const shift = curvature < 0 ? (0.5 * (left - right)) / curvature : 0;
  const refined = chosen + Math.max(-1, Math.min(1, shift));
  const clarity = curvature < 0 ? mid - 0.25 * (left - right) * shift : mid;
  return { hz: sampleRate / refined, clarity: Math.min(1, Math.max(0, clarity)) };
}
