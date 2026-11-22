/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { contrastRatio, oklchToLinear, type Rgb } from './contrast';

// Vitest empties CSS imports, so the stylesheet is read as text.
const css = readFileSync(resolve(import.meta.dirname, '../index.css'), 'utf8');

/** The `--token: value` pairs of the rule whose selector is exactly `selector`. */
export function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  return Object.fromEntries(
    [...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]),
  ) as Record<string, string>;
}

export type ThemeName = 'dark' | 'light';

export function theme(name: ThemeName): Record<string, string> {
  return { ...tokens(':root'), ...tokens(`:root[data-theme='${name}']`) };
}

/** A colour with alpha, as linear sRGB. */
export type Paint = { rgb: Rgb; alpha: number };

/** A token's paint: follows `var(--x)` chains and reads an `oklch(L C h / A%)` alpha. */
export function paint(values: Record<string, string>, name: string): Paint {
  const value = values[name];
  if (value === undefined) throw new Error(`no ${name}`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (ref?.[1]) return paint(values, ref[1]);
  const match = /^oklch\(([^/)]+)\/\s*([\d.]+)%\)$/.exec(value.trim());
  if (match) {
    return { rgb: oklchToLinear(`oklch(${match[1] ?? ''})`), alpha: Number(match[2]) / 100 };
  }
  return { rgb: oklchToLinear(value), alpha: 1 };
}

const toGamma = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Source-over in gamma-encoded sRGB, which is how a browser composites. */
export function over(top: Paint, bottom: Rgb): Rgb {
  const mix = (t: number, b: number) =>
    toLinear(toGamma(t) * top.alpha + toGamma(b) * (1 - top.alpha));
  return [mix(top.rgb[0], bottom[0]), mix(top.rgb[1], bottom[1]), mix(top.rgb[2], bottom[2])];
}

/** The contrast of token `fg` over token `bg`; a translucent `fg` is laid on `bg` first. */
export function tokenContrast(values: Record<string, string>, fg: string, bg: string): number {
  const back = paint(values, bg).rgb;
  return contrastRatio(over(paint(values, fg), back), back);
}

/** The contrast of `fg` painted over a translucent `tint` painted over `bg`. */
export function tintedContrast(
  values: Record<string, string>,
  fg: string,
  tint: Paint,
  bg: string,
): number {
  const surface = over(tint, paint(values, bg).rgb);
  return contrastRatio(over(paint(values, fg), surface), surface);
}
