import { path, point, polyline, rect } from '../../primitives';
import type { PathPrimitive } from '../../types';

interface Drawn {
  node?: string;
}

/** Wavelength, amplitude and stroke of each wave, in staff spaces. */
export const WAVES = {
  slight: { length: 0.9, amplitude: 0.22, stroke: 0.18 },
  wide: { length: 1.4, amplitude: 0.45, stroke: 0.24 },
  trill: { length: 0.7, amplitude: 0.18, stroke: 0.16 },
} as const;

/**
 * A pick scrape's wave out of a note, in staff spaces: how far it falls or rises (half a number's
 * height on the tab, a slide-out's drop on the standard staff), how far it reaches off its line
 * (its amplitude and half its stroke), and where it starts, stops short of the next onset and its
 * shortest length.
 */
export const SCRAPE = {
  drop: 0.5,
  reach: 0.5 + WAVES.slight.amplitude + WAVES.slight.stroke / 2,
  gap: 0.2,
  stop: 0.6,
  min: 1.3,
} as const;

export const SAWTOOTH = {
  slight: { length: 0.9, amplitude: 0.35, stroke: 0.16 },
  wide: { length: 1.4, amplitude: 0.6, stroke: 0.16 },
} as const;

export interface WaveShape {
  length: number;
  amplitude: number;
  stroke: number;
}

/**
 * A smooth wave from `x0` to `x1` around `y`: whole half-waves of quadratic curves, so it ends on
 * its centre line. Along y instead when `vertical`, from `y` to `y1` around `x`.
 */
function wave(
  from: number,
  to: number,
  across: number,
  shape: WaveShape,
  space: number,
  vertical: boolean,
  options: Drawn,
): PathPrimitive | undefined {
  const span = to - from;
  if (Math.abs(span) < space * 0.2) return undefined;
  const halves = Math.max(1, Math.floor(Math.abs(span) / ((shape.length * space) / 2)));
  const step = span / halves;
  const peak = 2 * shape.amplitude * space;
  const at = (along: number, off: number): string =>
    vertical ? point(across + off, along) : point(along, across + off);
  let d = `M${at(from, 0)}`;
  for (let i = 0; i < halves; i++) {
    const start = from + i * step;
    const side = i % 2 === 0 ? -1 : 1;
    d += `Q${at(start + step / 2, side * peak)} ${at(start + step, 0)}`;
  }
  const a = shape.amplitude * space;
  const low = Math.min(from, to);
  const box = vertical
    ? rect(across - a, low, a * 2, Math.abs(span))
    : rect(low, across - a, Math.abs(span), a * 2);
  return path(d, box, false, shape.stroke * space, options);
}

export function horizontalWave(
  x0: number,
  x1: number,
  y: number,
  shape: WaveShape,
  space: number,
  options: Drawn = {},
): PathPrimitive | undefined {
  return wave(x0, x1, y, shape, space, false, options);
}

/**
 * A smooth wave along the line from (x0, y0) to (x1, y1): the same half-waves as the straight
 * ones, bowed to either side of the line, so it ends on its line.
 */
export function diagonalWave(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  shape: WaveShape,
  space: number,
  options: Drawn = {},
): PathPrimitive | undefined {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const span = Math.hypot(dx, dy);
  if (span < space * 0.2) return undefined;
  const halves = Math.max(1, Math.floor(span / ((shape.length * space) / 2)));
  const peak = 2 * shape.amplitude * space;
  // The unit normal to the line, pointing down-right of its direction.
  const nx = -dy / span;
  const ny = dx / span;
  let d = `M${point(x0, y0)}`;
  const xs = [x0, x1];
  const ys = [y0, y1];
  for (let i = 0; i < halves; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const mid = (i + 0.5) / halves;
    const end = (i + 1) / halves;
    const cx = x0 + dx * mid + nx * side * peak;
    const cy = y0 + dy * mid + ny * side * peak;
    d += `Q${point(cx, cy)} ${point(x0 + dx * end, y0 + dy * end)}`;
    // The curve reaches half way to its control point.
    xs.push(x0 + dx * mid + (nx * side * peak) / 2);
    ys.push(y0 + dy * mid + (ny * side * peak) / 2);
  }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const box = rect(left, top, Math.max(...xs) - left, Math.max(...ys) - top);
  return path(d, box, false, shape.stroke * space, options);
}

export function verticalWave(
  y0: number,
  y1: number,
  x: number,
  shape: WaveShape,
  space: number,
  options: Drawn = {},
): PathPrimitive | undefined {
  return wave(y0, y1, x, shape, space, true, options);
}

/** A whammy-bar vibrato: slow rises and sharp drops around `y`. */
export function sawtooth(
  x0: number,
  x1: number,
  y: number,
  shape: WaveShape,
  space: number,
  options: Drawn = {},
): PathPrimitive | undefined {
  const span = x1 - x0;
  if (span < space * 0.2) return undefined;
  const teeth = Math.max(1, Math.round(span / (shape.length * space)));
  const tooth = span / teeth;
  const a = shape.amplitude * space;
  const points: [number, number][] = [[x0, y + a]];
  for (let i = 0; i < teeth; i++) {
    const start = x0 + i * tooth;
    points.push([start + tooth * 0.8, y - a], [start + tooth, y + a]);
  }
  return polyline(points, shape.stroke * space, options);
}
