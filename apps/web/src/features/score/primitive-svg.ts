import type { Primitive, Range, ThemeRole } from '@reprise/layout';

/** Every colour is `currentColor`: the role class sets `color` from a score token. */
const CURRENT = 'currentColor';

export const ROLE_CLASS: Readonly<Record<ThemeRole, string | undefined>> = {
  ink: undefined,
  paper: 'score-role-paper',
  muted: 'score-role-muted',
  accent: 'score-role-accent',
};

export interface TextShape {
  tag: 'text';
  text: string;
  props: {
    x: number;
    y: number;
    fontSize: number;
    fill: string;
    className: string;
    textAnchor?: 'middle' | 'end';
  };
}

export interface LineShape {
  tag: 'line';
  props: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    stroke: string;
    strokeWidth: number;
    strokeDasharray?: string;
    className?: string;
  };
}

export interface PathShape {
  tag: 'path';
  props: {
    d: string;
    fill: string;
    stroke?: string;
    strokeWidth?: number;
    className?: string;
  };
}

export type SvgShape = TextShape | LineShape | PathShape;

const classes = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ');

function roleClass(role: ThemeRole): { className?: string } {
  const name = ROLE_CLASS[role];
  return name === undefined ? {} : { className: name };
}

/** The SVG element a primitive draws as, with React prop names. */
export function primitiveToSvg(p: Primitive): SvgShape {
  switch (p.kind) {
    case 'glyph': {
      return {
        tag: 'text',
        text: String.fromCodePoint(p.codepoint),
        props: {
          x: p.x,
          y: p.y,
          fontSize: p.size,
          fill: CURRENT,
          className: classes('score-glyph', ROLE_CLASS[p.role]),
        },
      };
    }
    case 'text': {
      return {
        tag: 'text',
        text: p.text,
        props: {
          x: p.x,
          y: p.y,
          fontSize: p.size,
          fill: CURRENT,
          className: classes(
            'score-text',
            p.italic ? 'score-italic' : undefined,
            ROLE_CLASS[p.role],
          ),
          ...(p.anchor !== 'start' && { textAnchor: p.anchor }),
        },
      };
    }
    case 'line': {
      return {
        tag: 'line',
        props: {
          x1: p.x,
          y1: p.y,
          x2: p.x2,
          y2: p.y2,
          stroke: CURRENT,
          strokeWidth: p.thickness,
          ...(p.dash && { strokeDasharray: `${String(p.dash[0])} ${String(p.dash[1])}` }),
          ...roleClass(p.role),
        },
      };
    }
    case 'path': {
      const stroke =
        !p.fill || p.thickness > 0 ? { stroke: CURRENT, strokeWidth: p.thickness } : {};
      return {
        tag: 'path',
        props: { d: p.d, fill: p.fill ? CURRENT : 'none', ...stroke, ...roleClass(p.role) },
      };
    }
  }
}

/** Deep equality over plain data: numbers, strings, arrays and records, as layout emits. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const entries = Object.entries(a);
  if (entries.length !== Object.keys(b).length) return false;
  const other = new Map<string, unknown>(Object.entries(b));
  return entries.every(([key, value]) => other.has(key) && sameValue(value, other.get(key)));
}

/**
 * Whether two slices draw the same primitives. Layout hands a reused system's primitives over by
 * reference, possibly at shifted indices, and rebuilds the systems after an edit with equal values,
 * so identity is checked first and values only where it fails.
 */
export function samePrimitives(
  a: readonly Primitive[],
  rangeA: Range,
  b: readonly Primitive[],
  rangeB: Range,
): boolean {
  const length = rangeA.end - rangeA.start;
  if (length !== rangeB.end - rangeB.start) return false;
  if (a === b && rangeA.start === rangeB.start) return true;
  for (let i = 0; i < length; i++) {
    const p = a[rangeA.start + i];
    const q = b[rangeB.start + i];
    if (p !== q && !sameValue(p, q)) return false;
  }
  return true;
}
