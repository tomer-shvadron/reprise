import type { Anchor, LayoutResult, Primitive } from '../types';

const n = (value: number): string => String(value);

/** One readable line per primitive, for data snapshots. */
export function describePrimitive(primitive: Primitive): string {
  const at = `@${n(primitive.x)},${n(primitive.y)}`;
  const node = primitive.node === undefined ? '' : ` <${primitive.node}>`;
  const role = primitive.role === 'ink' ? '' : ` (${primitive.role})`;
  switch (primitive.kind) {
    case 'glyph':
      return `glyph ${primitive.glyph} ${at} size ${n(primitive.size)}${role}${node}`;
    case 'line':
      return `line ${at} -> ${n(primitive.x2)},${n(primitive.y2)} w ${n(primitive.thickness)}${role}${node}`;
    case 'path':
      return `path ${primitive.fill ? 'filled' : 'stroked'} ${primitive.d}${role}${node}`;
    case 'text':
      return `text "${primitive.text}" ${at} size ${n(primitive.size)} ${primitive.anchor}${primitive.italic ? ' italic' : ''}${role}${node}`;
  }
}

export function describeAnchor(anchor: Anchor): string {
  const { x, y, width, height } = anchor.bbox;
  const where = [anchor.track, anchor.staff, anchor.voice].filter((part) => part !== undefined);
  return `${anchor.kind} ${anchor.id} [${n(x)},${n(y)} ${n(width)}x${n(height)}]${where.length > 0 ? ` ${where.join(' ')}` : ''}`;
}

export function describe(result: LayoutResult): {
  systems: string[];
  primitives: string[];
  anchors: string[];
} {
  return {
    systems: result.systems.map(
      (system) =>
        `${system.id} page ${n(system.page)} bars ${n(system.bars.start)}-${n(system.bars.end)} [${n(system.bbox.x)},${n(system.bbox.y)} ${n(system.bbox.width)}x${n(system.bbox.height)}]${system.part === undefined ? '' : ` part ${n(system.part)}`}`,
    ),
    primitives: result.primitives.map(describePrimitive),
    anchors: result.anchors.map(describeAnchor),
  };
}
