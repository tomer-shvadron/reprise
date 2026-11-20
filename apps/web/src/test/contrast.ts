/** WCAG contrast from the `oklch(L C h)` values the theme tokens are written in. */

export type Rgb = readonly [number, number, number];

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const OKLAB = /^oklab\(\s*([\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/;

/** An opaque `oklch(L C h)` to linear sRGB, clamped into the gamut. */
export function oklchToLinear(color: string): Rgb {
  const match = OKLCH.exec(color.trim());
  if (!match) throw new Error(`not an opaque oklch(L C h) colour: ${color}`);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  return oklabToLinear(Number(match[1]), chroma * Math.cos(hue), chroma * Math.sin(hue));
}

function oklabToLinear(lightness: number, a: number, b: number): Rgb {
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** WCAG relative luminance of a linear sRGB colour. */
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two linear sRGB colours, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** The contrast of two `oklch(L C h)` colours. */
export function oklchContrast(foreground: string, background: string): number {
  return contrastRatio(oklchToLinear(foreground), oklchToLinear(background));
}

const srgbToLinear = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const channel = (value: string | undefined, max: number) => srgbToLinear(Number(value) / max);

const RGB = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*\)$/;
const COLOR_SRGB = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

/**
 * Any opaque colour a browser reports for `getComputedStyle`: `oklch(...)`, `oklab(...)`,
 * `rgb(...)` or `color(srgb ...)`, as linear sRGB.
 */
export function cssColorToLinear(color: string): Rgb {
  const text = color.trim();
  if (text.startsWith('oklch(')) return oklchToLinear(text);
  const lab = OKLAB.exec(text);
  if (lab) return oklabToLinear(Number(lab[1]), Number(lab[2]), Number(lab[3]));
  const rgb = RGB.exec(text);
  if (rgb) return [channel(rgb[1], 255), channel(rgb[2], 255), channel(rgb[3], 255)];
  const srgb = COLOR_SRGB.exec(text);
  if (srgb) return [channel(srgb[1], 1), channel(srgb[2], 1), channel(srgb[3], 1)];
  throw new Error(`not an opaque oklch, oklab, rgb or color(srgb) colour: ${color}`);
}

/** The contrast of two computed CSS colours. */
export function cssContrast(foreground: string, background: string): number {
  return contrastRatio(cssColorToLinear(foreground), cssColorToLinear(background));
}
