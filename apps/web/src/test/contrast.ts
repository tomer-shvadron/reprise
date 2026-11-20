/** WCAG contrast from the `oklch(L C h)` values the theme tokens are written in. */

export type Rgb = readonly [number, number, number];

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** An opaque `oklch(L C h)` to linear sRGB, clamped into the gamut. */
export function oklchToLinear(color: string): Rgb {
  const match = OKLCH.exec(color.trim());
  if (!match) throw new Error(`not an opaque oklch(L C h) colour: ${color}`);
  const lightness = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = (Number(match[3]) * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
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
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** The contrast of two `oklch(L C h)` colours. */
export function oklchContrast(foreground: string, background: string): number {
  return contrastRatio(oklchToLinear(foreground), oklchToLinear(background));
}
