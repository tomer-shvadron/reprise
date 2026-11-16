export const DRIVE_CURVES = ['clean', 'overdrive', 'distortion', 'fuzz'] as const;
export type DriveCurve = (typeof DRIVE_CURVES)[number];

/** Odd, so the middle sample is exactly 0 and silence stays silent, as the master ceiling's. */
export const CURVE_SAMPLES = 4097;
/** The curve spans +-4 of its input, so a boosted signal is shaped rather than clipped at the ends. */
export const CURVE_RANGE = 4;
/** Every curve saturates here, inside +-1, so the shaper's end clamp is never the clipping. */
export const CURVE_LEVEL = 0.8;

/** Steepness `k` of `CURVE_LEVEL * tanh(k * x)`, per side; only fuzz differs between the sides. */
const STEEPNESS: Record<DriveCurve, { positive: number; negative: number }> = {
  // Unity small-signal gain, so the clean curve only rounds peaks off.
  clean: { positive: 1 / CURVE_LEVEL, negative: 1 / CURVE_LEVEL },
  overdrive: { positive: 3.5, negative: 3.5 },
  distortion: { positive: 25, negative: 25 },
  // Harder on one side: even harmonics as well as odd ones.
  fuzz: { positive: 40, negative: 14 },
};

/** Oversampling per curve: the harder the clipping, the more aliasing it needs to push out. */
export const DRIVE_OVERSAMPLE: Record<DriveCurve, 'none' | '2x' | '4x'> = {
  clean: 'none',
  overdrive: '2x',
  distortion: '4x',
  fuzz: '4x',
};

/** A wave-shaper curve over `+-CURVE_RANGE`: a pure function of the type. */
export function driveCurve(type: DriveCurve): Float32Array<ArrayBuffer> {
  const { positive, negative } = STEEPNESS[type];
  const curve = new Float32Array(CURVE_SAMPLES);
  for (let i = 0; i < CURVE_SAMPLES; i += 1) {
    const x = ((i / (CURVE_SAMPLES - 1)) * 2 - 1) * CURVE_RANGE;
    curve[i] = CURVE_LEVEL * Math.tanh((x >= 0 ? positive : negative) * x);
  }
  return curve;
}
