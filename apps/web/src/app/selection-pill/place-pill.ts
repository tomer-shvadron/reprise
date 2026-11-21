import type { Rect } from '@reprise/layout';

/** One system part of the anchored selection, in canvas px. */
export interface PillPart {
  box: Rect;
  /** The staff band nearest above the part that overlaps it horizontally, if any. */
  above?: Rect | undefined;
}

export interface PlacePillInput {
  parts: readonly PillPart[];
  /** The pill's own size, in screen px. */
  size: { width: number; height: number };
  /** The visible window, in canvas px, with the bottom inset already taken off. */
  visible: Rect;
  /** Between the pill and the part. */
  gap?: number;
  /** Kept clear of the window's left and right edges. */
  margin?: number;
}

export interface PillPlacement {
  /** The pill's top-left corner in canvas px. */
  x: number;
  y: number;
  side: 'above' | 'below';
}

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Where the pill goes: above the first part of the selection that is in view, centred on its
 * visible width and kept inside the window; below it instead when above would cover the staff
 * above or leave the window at the top, unless below would leave at the bottom. `undefined` when
 * no part is in view, so the pill hides while its selection is scrolled away.
 */
export function placePill({
  parts,
  size,
  visible,
  gap = 6,
  margin = 8,
}: PlacePillInput): PillPlacement | undefined {
  const part = parts.find(({ box }) => intersects(box, visible));
  if (!part) return undefined;
  const { box, above } = part;
  const left = Math.max(box.x, visible.x);
  const right = Math.min(box.x + box.width, visible.x + visible.width);
  const x = clamp(
    (left + right) / 2 - size.width / 2,
    visible.x + margin,
    visible.x + visible.width - margin - size.width,
  );
  const aboveY = box.y - gap - size.height;
  const belowY = box.y + box.height + gap;
  const top = visible.y;
  const bottom = visible.y + visible.height;
  const covers =
    above !== undefined && aboveY < above.y + above.height && aboveY + size.height > above.y;
  if (aboveY >= top && !covers) return { x, y: aboveY, side: 'above' };
  if (belowY + size.height <= bottom) return { x, y: belowY, side: 'below' };
  return { x, y: clamp(aboveY, top, bottom - size.height), side: 'above' };
}
