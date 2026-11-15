/** In-place radix-2 complex FFT; `re` and `im` share a power-of-two length. */
function transform(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i] ?? 0;
      re[i] = re[j] ?? 0;
      re[j] = tr;
      const ti = im[i] ?? 0;
      im[i] = im[j] ?? 0;
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angle = ((inverse ? 2 : -2) * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const br = re[b] ?? 0;
        const bi = im[b] ?? 0;
        const tr = br * cr - bi * ci;
        const ti = br * ci + bi * cr;
        re[b] = (re[a] ?? 0) - tr;
        im[b] = (im[a] ?? 0) - ti;
        re[a] = (re[a] ?? 0) + tr;
        im[a] = (im[a] ?? 0) + ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i += 1) {
      re[i] = (re[i] ?? 0) / n;
      im[i] = (im[i] ?? 0) / n;
    }
  }
}

/**
 * The linear autocorrelation `r(τ) = Σ x[j]·x[j+τ]` for τ in [0, N), through an FFT of the frame
 * zero-padded to 2N so the circular product does not wrap.
 */
export function autocorrelate(frame: Float32Array | Float64Array): Float64Array {
  const n = frame.length;
  let size = 1;
  while (size < 2 * n) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  re.set(frame);
  transform(re, im, false);
  for (let i = 0; i < size; i += 1) {
    const a = re[i] ?? 0;
    const b = im[i] ?? 0;
    re[i] = a * a + b * b;
    im[i] = 0;
  }
  transform(re, im, true);
  return re.slice(0, n);
}
