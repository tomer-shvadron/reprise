import { describe, expect, it } from 'vitest';

import { contrastRatio, cssContrast, oklchContrast, oklchToLinear } from './contrast';

describe('contrast', () => {
  it('puts black on white at 21', () => {
    expect(oklchContrast('oklch(0 0 0)', 'oklch(1 0 0)')).toBeCloseTo(21, 1);
  });

  it('reads #767676 on white as about 4.54', () => {
    // #767676 is oklch(0.5681 0 0) to four places.
    expect(oklchContrast('oklch(0.5681 0 0)', 'oklch(1 0 0)')).toBeCloseTo(4.54, 1);
  });

  it('is symmetric and 1 for equal colours', () => {
    const grey = oklchToLinear('oklch(0.5 0 0)');
    expect(contrastRatio(grey, grey)).toBe(1);
  });

  it('rejects a colour with an alpha channel', () => {
    expect(() => oklchToLinear('oklch(1 0 0 / 10%)')).toThrow();
  });

  it('reads the colour forms a browser reports', () => {
    expect(cssContrast('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBeCloseTo(21, 1);
    expect(cssContrast('rgb(118 118 118)', 'color(srgb 1 1 1)')).toBeCloseTo(4.54, 1);
    expect(cssContrast('oklch(0 0 0)', 'rgb(255, 255, 255)')).toBeCloseTo(21, 1);
    // Chromium reports a grey `oklch(L 0 0)` as `oklab(L 0 0)`.
    expect(cssContrast('oklab(0 0 0)', 'oklab(1 0 0)')).toBeCloseTo(21, 1);
    expect(() => cssContrast('red', 'white')).toThrow();
  });
});
