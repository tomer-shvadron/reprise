/**
 * Impulse responses, generated from fixed seeds: no recording, no third-party material, nothing
 * committed or fetched. They take the context's sample rate, because a `ConvolverNode` refuses a
 * buffer of another rate. Pure arithmetic, so it also runs under Node.
 */

export const CABINETS = ['open-1x12', 'closed-2x12', 'closed-4x12'] as const;
export type CabinetId = (typeof CABINETS)[number];

/** About 46 ms at 44.1 kHz. */
export const CABINET_SAMPLES = 2048;
const CABINET_FADE = 512;
export const ROOM_SECONDS = 1.4;
const ROOM_PRE_DELAY = 0.01;

/** A small, fast, seeded generator (mulberry32): the same seed gives the same impulse everywhere. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One biquad section, coefficients from the RBJ cookbook, normalised by a0. */
interface Section {
  b: [number, number, number];
  a: [number, number];
}

function section(
  kind: 'highpass' | 'lowpass' | 'peaking',
  sampleRate: number,
  frequency: number,
  q: number,
  gainDb = 0,
): Section {
  const w = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  const amp = 10 ** (gainDb / 40);
  let b: [number, number, number];
  let a: [number, number, number];
  if (kind === 'highpass') {
    b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
    a = [1 + alpha, -2 * cos, 1 - alpha];
  } else if (kind === 'lowpass') {
    b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
    a = [1 + alpha, -2 * cos, 1 - alpha];
  } else {
    b = [1 + alpha * amp, -2 * cos, 1 - alpha * amp];
    a = [1 + alpha / amp, -2 * cos, 1 - alpha / amp];
  }
  return { b: [b[0] / a[0], b[1] / a[0], b[2] / a[0]], a: [a[1] / a[0], a[2] / a[0]] };
}

function run(data: Float32Array, { b, a }: Section): void {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < data.length; i += 1) {
    const x = data[i] ?? 0;
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[i] = y;
  }
}

function normalise(...channels: Float32Array[]): void {
  let energy = 0;
  for (const data of channels) for (const value of data) energy += value * value;
  const scale = energy > 0 ? 1 / Math.sqrt(energy) : 1;
  for (const data of channels)
    for (let i = 0; i < data.length; i += 1) data[i] = (data[i] ?? 0) * scale;
}

interface CabinetSpec {
  highpass: number;
  /** Cone resonance, then the presence peak, in dB. */
  bump: [number, number];
  presence: [number, number];
  notches: number[];
  lowpass: number;
}

const CABINET_SPECS: Record<CabinetId, CabinetSpec> = {
  'open-1x12': {
    highpass: 90,
    bump: [125, 3],
    presence: [2600, 4],
    notches: [1700, 3900],
    lowpass: 6000,
  },
  'closed-2x12': {
    highpass: 80,
    bump: [110, 4],
    presence: [2400, 5],
    notches: [1500, 3600],
    lowpass: 5200,
  },
  'closed-4x12': {
    highpass: 70,
    bump: [100, 5],
    presence: [2200, 5],
    notches: [1400, 3300],
    lowpass: 4600,
  },
};

/** A cabinet: a unit impulse through highpass, resonance, presence, two notches and a 6th-order lowpass. */
export function cabinetImpulse(id: CabinetId, sampleRate: number): Float32Array<ArrayBuffer> {
  const spec = CABINET_SPECS[id];
  const data = new Float32Array(CABINET_SAMPLES);
  data[0] = 1;
  const sections = [
    section('highpass', sampleRate, spec.highpass, 0.8),
    section('peaking', sampleRate, spec.bump[0], 1.2, spec.bump[1]),
    section('peaking', sampleRate, spec.presence[0], 1, spec.presence[1]),
    ...spec.notches.map((frequency) => section('peaking', sampleRate, frequency, 4, -7)),
    // Butterworth sixth order: three sections at these Qs.
    section('lowpass', sampleRate, spec.lowpass, 0.5176),
    section('lowpass', sampleRate, spec.lowpass, 0.7071),
    section('lowpass', sampleRate, spec.lowpass, 1.9319),
  ];
  for (const each of sections) run(data, each);
  for (let i = 0; i < CABINET_FADE; i += 1) {
    const at = CABINET_SAMPLES - CABINET_FADE + i;
    data[at] = (data[at] ?? 0) * (0.5 + 0.5 * Math.cos((Math.PI * (i + 1)) / CABINET_FADE));
  }
  normalise(data);
  return data;
}

function gaussian(random: () => number): number {
  // Two uniform draws; the first is kept away from 0 so the log is finite.
  const u = Math.max(random(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

function roomChannel(sampleRate: number, seed: number): Float32Array<ArrayBuffer> {
  const length = Math.round(ROOM_SECONDS * sampleRate);
  const random = mulberry32(seed);
  const data = new Float32Array(length);
  const pre = Math.round(ROOM_PRE_DELAY * sampleRate);
  // Early reflections: 12 taps between 5 and 60 ms, fading, with random signs.
  for (let tap = 0; tap < 12; tap += 1) {
    const at = Math.round((0.005 + random() * 0.055) * sampleRate);
    const level = (random() < 0.5 ? -1 : 1) * 0.6 * 0.9 ** tap;
    data[at] = (data[at] ?? 0) + level;
  }
  // Late tail: two noise bands decaying at their own rate (RT60 0.9 s lows, 0.5 s highs).
  const lowRate = 6.91 / 0.9;
  const highRate = 6.91 / 0.5;
  let smooth = 0;
  const pole = Math.exp((-2 * Math.PI * 500) / sampleRate);
  let blockedIn = 0;
  let blockedOut = 0;
  for (let i = pre; i < length; i += 1) {
    const noise = gaussian(random);
    smooth = pole * smooth + (1 - pole) * noise;
    // A one-pole highpass keeps the band free of DC, which the decay would otherwise carry.
    blockedOut = smooth - blockedIn + 0.995 * blockedOut;
    blockedIn = smooth;
    const lowBand = blockedOut * 6;
    const t = (i - pre) / sampleRate;
    const ramp = Math.min(1, t / 0.02);
    const high = noise - smooth;
    data[i] =
      (data[i] ?? 0) +
      ramp * (lowBand * Math.exp(-lowRate * t) * 0.6 + high * Math.exp(-highRate * t) * 0.4);
  }
  return data;
}

/** A room: stereo, 1.4 s, 10 ms pre-delay; the channels use independent seeds. */
export function roomImpulse(
  sampleRate: number,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const left = roomChannel(sampleRate, 0x5eed0001);
  const right = roomChannel(sampleRate, 0x5eed0002);
  normalise(left, right);
  return [left, right];
}
