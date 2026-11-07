import { LANES_ABOVE, LANES_BELOW, type LaneBand, type LaneId } from './staves/lanes';
import type { Range } from './types';
import { ROW_HEIGHT, type VerticalLayout } from './vertical';

const LANES: readonly LaneId[] = [...LANES_ABOVE, ...LANES_BELOW];

function rowsHeight(rows: VerticalLayout['rows']): number {
  let height = 0;
  for (const row of Object.values(rows)) height = Math.max(height, row.bottom);
  return height;
}

/** A continuation's rows: its bar numbers, then the voltas when the system has them. */
export function continuationRows(vertical: VerticalLayout, space: number): VerticalLayout['rows'] {
  const barNumber = { top: 0, bottom: ROW_HEIGHT.barNumber * space };
  if (!vertical.rows.volta) return { barNumber };
  return {
    barNumber,
    volta: { top: barNumber.bottom, bottom: barNumber.bottom + ROW_HEIGHT.volta * space },
  };
}

/** How far a part's staves move up from their place in the whole system. */
function shiftOf(vertical: VerticalLayout, range: Range, space: number): number {
  const first = vertical.staves[range.start];
  if (range.start === 0 || !first) return 0;
  return rowsHeight(continuationRows(vertical, space)) - (first.top - first.above);
}

/** Height of the part holding slots `range`: the first part keeps the system's rows. */
export function partHeight(vertical: VerticalLayout, range: Range, space: number): number {
  const last = vertical.staves[range.end - 1];
  if (!last) return 0;
  return last.bottom + last.below + shiftOf(vertical, range, space);
}

/** `vertical` re-based to its part's top: rows, the part's staves and lane bands, groups, height. */
export function partVertical(
  vertical: VerticalLayout,
  groups: readonly number[],
  range: Range,
  space: number,
): VerticalLayout {
  const shift = shiftOf(vertical, range, space);
  const staves = vertical.staves.map((staff, i) => {
    if (shift === 0 || i < range.start || i >= range.end) return staff;
    const lanes: Partial<Record<LaneId, LaneBand>> = {};
    for (const lane of LANES) {
      const band = staff.lanes[lane];
      if (band) lanes[lane] = { top: band.top + shift, bottom: band.bottom + shift };
    }
    return { ...staff, top: staff.top + shift, bottom: staff.bottom + shift, lanes };
  });
  // Only the part's tracks: render names and anchors a track by its group.
  const partGroups: VerticalLayout['groups'] = [];
  for (let i = range.start; i < range.end; i++) {
    const g = groups[i];
    const staff = staves[i];
    if (g === undefined || !staff) continue;
    const group = partGroups[g];
    if (group) group.bottom = staff.bottom;
    else partGroups[g] = { top: staff.top, bottom: staff.bottom };
  }
  return {
    rows: range.start === 0 ? vertical.rows : continuationRows(vertical, space),
    staves,
    groups: partGroups,
    height: partHeight(vertical, range, space),
    key: vertical.key,
  };
}

/**
 * The parts of a system taller than `room`: each holds as many whole tracks as fit, a track's
 * staves part only when the track alone is taller than `room`, and a staff taller than `room` is
 * a part of its own. The first part fits `firstRoom`, the room left under a first page's header.
 */
export function splitSlots(
  vertical: VerticalLayout,
  groups: readonly number[],
  room: number,
  space: number,
  firstRoom = room,
): Range[] {
  const parts: Range[] = [];
  const count = vertical.staves.length;
  let start = 0;
  while (start < count) {
    let trackEnd = -1;
    let fits = -1;
    for (let e = start; e < count; e++) {
      if (partHeight(vertical, { start, end: e + 1 }, space) > (start === 0 ? firstRoom : room)) {
        break;
      }
      fits = e;
      if (groups[e + 1] !== groups[e]) trackEnd = e;
    }
    const end = (trackEnd >= 0 ? trackEnd : fits >= 0 ? fits : start) + 1;
    parts.push({ start, end });
    start = end;
  }
  return parts;
}
