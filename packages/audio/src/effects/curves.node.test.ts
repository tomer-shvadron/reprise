import { describe, expect, it } from 'vitest';

import { CURVE_SAMPLES, DRIVE_CURVES, driveCurve } from './curves';

describe('driveCurve', () => {
  it.each(DRIVE_CURVES)(
    '%s: odd length, silence stays exactly 0, bounded and monotonic',
    (type) => {
      const curve = driveCurve(type);
      expect(curve).toHaveLength(CURVE_SAMPLES);
      expect(CURVE_SAMPLES % 2).toBe(1);
      expect(curve[(CURVE_SAMPLES - 1) / 2]).toBe(0);
      for (let i = 0; i < curve.length; i += 1) {
        expect(Math.abs(curve[i] ?? 2)).toBeLessThan(0.81);
        if (i > 0) expect(curve[i] ?? 0).toBeGreaterThanOrEqual(curve[i - 1] ?? 0);
      }
    },
  );

  it.each(['clean', 'overdrive', 'distortion'] as const)('%s is odd-symmetric', (type) => {
    const curve = driveCurve(type);
    for (let i = 0; i < curve.length; i += 1) {
      expect(curve[i]).toBeCloseTo(-(curve[curve.length - 1 - i] ?? 0), 6);
    }
  });

  it('fuzz is not symmetric, which is where its even harmonics come from', () => {
    const curve = driveCurve('fuzz');
    const probe = Math.round(CURVE_SAMPLES * 0.5125);
    expect(Math.abs((curve[probe] ?? 0) + (curve[CURVE_SAMPLES - 1 - probe] ?? 0))).toBeGreaterThan(
      0.05,
    );
  });

  it('is a pure function of the type', () => {
    expect(driveCurve('distortion')).toEqual(driveCurve('distortion'));
  });
});
