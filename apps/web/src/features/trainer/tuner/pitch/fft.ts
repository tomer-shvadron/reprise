export interface Autocorrelator {
  /** Writes `r(τ) = Σ x[j]·x[j+τ]` for τ in [0, N) into `out`. */
  run(frame: ArrayLike<number>, out: Float64Array): void;
}

/**
 * Autocorrelation through a radix-2 FFT of the frame zero-padded to 2N, so the circular product
 * does not wrap. Every buffer and table is made here, once, so a frame allocates nothing.
 */
export function createAutocorrelator(n: number): Autocorrelator {
  let size = 1;
  while (size < 2 * n) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  const reversed = new Uint32Array(size);
  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    reversed[i] = j;
  }
  const cos = new Float64Array(size / 2);
  const sin = new Float64Array(size / 2);
  for (let k = 0; k < size / 2; k += 1) {
    cos[k] = Math.cos((-2 * Math.PI * k) / size);
    sin[k] = Math.sin((-2 * Math.PI * k) / size);
  }

  // The inverse transform is the forward one on the conjugate; the spectrum here is real, so
  // running the forward transform again and scaling gives the same values.
  const transform = () => {
    for (let i = 1; i < size; i += 1) {
      const j = reversed[i] ?? 0;
      if (i < j) {
        const tr = re[i] ?? 0;
        re[i] = re[j] ?? 0;
        re[j] = tr;
        const ti = im[i] ?? 0;
        im[i] = im[j] ?? 0;
        im[j] = ti;
      }
    }
    for (let width = 2; width <= size; width <<= 1) {
      const half = width >> 1;
      const step = size / width;
      for (let start = 0; start < size; start += width) {
        for (let k = 0; k < half; k += 1) {
          const a = start + k;
          const b = a + half;
          const cr = cos[k * step] ?? 1;
          const ci = sin[k * step] ?? 0;
          const br = re[b] ?? 0;
          const bi = im[b] ?? 0;
          const tr = br * cr - bi * ci;
          const ti = br * ci + bi * cr;
          re[b] = (re[a] ?? 0) - tr;
          im[b] = (im[a] ?? 0) - ti;
          re[a] = (re[a] ?? 0) + tr;
          im[a] = (im[a] ?? 0) + ti;
        }
      }
    }
  };

  return {
    run(frame, out) {
      re.fill(0);
      im.fill(0);
      for (let i = 0; i < n; i += 1) re[i] = frame[i] ?? 0;
      transform();
      for (let i = 0; i < size; i += 1) {
        const a = re[i] ?? 0;
        const b = im[i] ?? 0;
        re[i] = a * a + b * b;
        im[i] = 0;
      }
      // The power spectrum is real and even, so its forward transform is the inverse up to 1/size.
      transform();
      for (let i = 0; i < n; i += 1) out[i] = (re[i] ?? 0) / size;
    },
  };
}

const cache = new Map<number, Autocorrelator>();

/** The linear autocorrelation of a frame, for tests; the detector keeps its own correlator. */
export function autocorrelate(frame: Float32Array | Float64Array): Float64Array {
  let correlator = cache.get(frame.length);
  if (!correlator) {
    correlator = createAutocorrelator(frame.length);
    cache.set(frame.length, correlator);
  }
  const out = new Float64Array(frame.length);
  correlator.run(frame, out);
  return out;
}
