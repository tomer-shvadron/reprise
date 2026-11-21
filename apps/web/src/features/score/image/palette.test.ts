import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PALETTE } from './palette';

const css = readFileSync(join(import.meta.dirname, '..', '..', '..', 'index.css'), 'utf8');

/** OKLCH to sRGB hex (Björn Ottosson's matrices), clipped to the gamut. */
function oklchToHex(lightness: number, chroma: number, hue: number): string {
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((value) => {
      const c = Math.min(1, Math.max(0, value));
      const gamma = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
      return Math.round(gamma * 255)
        .toString(16)
        .padStart(2, '0');
    })
    .join('')}`;
}

function token(name: string): string {
  const match = new RegExp(`${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\)`).exec(css);
  if (!match) throw new Error(`no oklch token ${name} in index.css`);
  return oklchToHex(Number(match[1]), Number(match[2]), Number(match[3]));
}

const channels = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

describe('export palette', () => {
  it.each([
    ['ink', '--ink-light'],
    ['muted', '--ink-muted-light'],
    ['accent', '--paper-accent-light'],
    ['paper', '--paper-light'],
  ] as const)('keeps %s within one step of %s in index.css', (role, name) => {
    const expected = channels(token(name));
    const actual = channels(PALETTE[role]);
    actual.forEach((value, i) => {
      expect(Math.abs(value - (expected[i] ?? 0))).toBeLessThanOrEqual(1);
    });
  });
});
