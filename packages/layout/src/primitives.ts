import type { Id } from '@reprise/model';

import { glyphMetrics, textExtent, textWidth, type GlyphName } from './metrics';
import type {
  Anchor,
  GlyphPrimitive,
  LinePrimitive,
  PathPrimitive,
  Primitive,
  Rect,
  TextPrimitive,
  ThemeRole,
} from './types';

/** Coordinates are rounded to 1/100 px so results serialise compactly and compare exactly. */
export function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x: round(x), y: round(y), width: round(width), height: round(height) };
}

export function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return rect(
    x,
    y,
    Math.max(a.x + a.width, b.x + b.width) - x,
    Math.max(a.y + a.height, b.y + b.height) - y,
  );
}

/** Where primitives and anchors go while a system is drawn. */
export interface LayoutSink {
  readonly primitives: Primitive[];
  readonly anchors: Anchor[];
}

interface Common {
  role?: ThemeRole;
  node?: Id;
}

function common({ role = 'ink', node }: Common): { role: ThemeRole; node?: Id } {
  return node === undefined ? { role } : { role, node };
}

/** A Bravura glyph with its origin at (x, y); `scale` 1 is the size that fits a five-line staff. */
export function glyph(
  name: GlyphName,
  x: number,
  y: number,
  space: number,
  options: Common & { scale?: number } = {},
): GlyphPrimitive {
  const { codepoint, bbox } = glyphMetrics(name);
  const unit = space * (options.scale ?? 1);
  return {
    kind: 'glyph',
    glyph: name,
    codepoint,
    x: round(x),
    y: round(y),
    size: round(unit * 4),
    bbox: rect(
      x + bbox.left * unit,
      y - bbox.top * unit,
      (bbox.right - bbox.left) * unit,
      (bbox.top - bbox.bottom) * unit,
    ),
    ...common(options),
  };
}

export function glyphWidth(name: GlyphName, space: number, scale = 1): number {
  return glyphMetrics(name).advance * space * scale;
}

export function line(
  x: number,
  y: number,
  x2: number,
  y2: number,
  thickness: number,
  options: Common & { dash?: [number, number] } = {},
): LinePrimitive {
  const half = thickness / 2;
  const vertical = x === x2;
  return {
    kind: 'line',
    x: round(x),
    y: round(y),
    x2: round(x2),
    y2: round(y2),
    thickness: round(thickness),
    bbox: vertical
      ? rect(x - half, Math.min(y, y2), thickness, Math.abs(y2 - y))
      : rect(
          Math.min(x, x2),
          Math.min(y, y2) - half,
          Math.abs(x2 - x),
          Math.abs(y2 - y) + thickness,
        ),
    ...(options.dash && { dash: [round(options.dash[0]), round(options.dash[1])] }),
    ...common(options),
  };
}

/** A rectangle outline, or a filled one. */
export function box(
  area: Rect,
  thickness: number,
  options: Common & { fill?: boolean } = {},
): PathPrimitive {
  const { x, y, width, height } = rect(area.x, area.y, area.width, area.height);
  return {
    kind: 'path',
    x,
    y,
    d: `M${String(x)} ${String(y)}h${String(width)}v${String(height)}h${String(-width)}Z`,
    fill: options.fill ?? false,
    thickness: round(thickness),
    bbox: rect(x, y, width, height),
    ...common(options),
  };
}

/** SVG path data `d` in its system's coordinates, whose extent the caller knows. */
export function path(
  d: string,
  bbox: Rect,
  fill: boolean,
  thickness: number,
  options: Common = {},
): PathPrimitive {
  return {
    kind: 'path',
    x: bbox.x,
    y: bbox.y,
    d,
    fill,
    thickness: round(thickness),
    bbox,
    ...common(options),
  };
}

/** A point for path data, rounded like every emitted coordinate. */
export function point(x: number, y: number): string {
  return `${String(round(x))} ${String(round(y))}`;
}

/** Arrowheads are filled triangles this wide and long, in staff spaces. */
const ARROW_WIDTH = 0.7;
export const ARROW_LENGTH = 0.8;

/** A filled triangular arrowhead with its tip at (x, y), pointing up or down. */
export function arrowhead(
  x: number,
  y: number,
  direction: 'up' | 'down',
  space: number,
  options: Common = {},
): PathPrimitive {
  const half = (ARROW_WIDTH * space) / 2;
  const length = ARROW_LENGTH * space * (direction === 'up' ? 1 : -1);
  const d = `M${point(x, y)}L${point(x + half, y + length)}L${point(x - half, y + length)}Z`;
  return path(
    d,
    rect(x - half, Math.min(y, y + length), half * 2, Math.abs(length)),
    true,
    0,
    options,
  );
}

/** An open polyline through `points`, stroked. */
export function polyline(
  points: readonly (readonly [number, number])[],
  thickness: number,
  options: Common = {},
): PathPrimitive {
  const rounded = points.map(([px, py]): [number, number] => [round(px), round(py)]);
  const xs = rounded.map(([px]) => px);
  const ys = rounded.map(([, py]) => py);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const [first] = rounded;
  return {
    kind: 'path',
    x: first?.[0] ?? 0,
    y: first?.[1] ?? 0,
    d: rounded.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${String(px)} ${String(py)}`).join(''),
    fill: false,
    thickness: round(thickness),
    bbox: rect(left, top, Math.max(...xs) - left, Math.max(...ys) - top),
    ...common(options),
  };
}

export function text(
  content: string,
  x: number,
  y: number,
  size: number,
  options: Common & { anchor?: TextPrimitive['anchor']; italic?: boolean } = {},
): TextPrimitive {
  const anchor = options.anchor ?? 'start';
  const width = textWidth(content, size);
  const { ascent, descent } = textExtent(size);
  const left = anchor === 'start' ? x : anchor === 'middle' ? x - width / 2 : x - width;
  return {
    kind: 'text',
    text: content,
    x: round(x),
    y: round(y),
    size: round(size),
    anchor,
    italic: options.italic ?? false,
    bbox: rect(left, y - ascent, width, ascent + descent),
    ...common(options),
  };
}
