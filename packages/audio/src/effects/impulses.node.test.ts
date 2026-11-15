import { describe, expect, it } from 'vitest';

import { bandEnergy, rms } from '../test/signal';
import { CABINETS, CABINET_SAMPLES, ROOM_SECONDS, cabinetImpulse, roomImpulse } from './impulses';

const RATES = [44_100, 48_000];
const energy = (data: Float32Array): number => data.reduce((sum, value) => sum + value * value, 0);

describe.each(RATES)('impulse responses at %i Hz', (sampleRate) => {
  it.each(CABINETS)('cabinet %s: deterministic, 2048 samples, unit energy, no DC', (id) => {
    const impulse = cabinetImpulse(id, sampleRate);
    expect(cabinetImpulse(id, sampleRate)).toEqual(impulse);
    expect(impulse).toHaveLength(CABINET_SAMPLES);
    expect(energy(impulse)).toBeCloseTo(1, 5);
    const sum = impulse.reduce((total, value) => total + value, 0);
    expect(Math.abs(sum)).toBeLessThan(0.05);
  });

  it.each(CABINETS)('cabinet %s: 8 to 12 kHz at least 20 dB under 1 to 2 kHz', (id) => {
    const signal = { data: cabinetImpulse(id, sampleRate), sampleRate };
    const high = bandEnergy(signal, 8000, 12_000, 0, 1);
    const mid = bandEnergy(signal, 1000, 2000, 0, 1);
    expect(20 * Math.log10(high / mid)).toBeLessThanOrEqual(-20);
  });

  it('room: stereo, deterministic, 1.4 s, unit energy', () => {
    const [left, right] = roomImpulse(sampleRate);
    expect(roomImpulse(sampleRate)[0]).toEqual(left);
    expect(left).toHaveLength(Math.round(ROOM_SECONDS * sampleRate));
    expect(energy(left) + energy(right)).toBeCloseTo(1, 5);
  });

  it('room: the tail is 50 dB under the start, the channels are decorrelated, no DC', () => {
    const [left, right] = roomImpulse(sampleRate);
    const first = rms({ data: left, sampleRate }, 0.11, 0.21);
    const last = rms({ data: left, sampleRate }, ROOM_SECONDS - 0.1, ROOM_SECONDS);
    expect(20 * Math.log10(last / first)).toBeLessThanOrEqual(-50);
    let cross = 0;
    for (let i = 0; i < left.length; i += 1) cross += (left[i] ?? 0) * (right[i] ?? 0);
    expect(Math.abs(cross) / Math.sqrt(energy(left) * energy(right))).toBeLessThan(0.3);
    for (const data of [left, right]) {
      const mean = data.reduce((total, value) => total + value, 0) / data.length;
      expect(Math.abs(mean)).toBeLessThan(0.05 * Math.sqrt(energy(data) / data.length));
    }
  });

  it('keeps every impulse under 2 MB resident', () => {
    const room = roomImpulse(sampleRate).reduce((total, data) => total + data.byteLength, 0);
    const cabinets = CABINETS.reduce(
      (total, id) => total + cabinetImpulse(id, sampleRate).byteLength,
      0,
    );
    expect(room + cabinets).toBeLessThan(2 * 1024 * 1024);
  });
});
