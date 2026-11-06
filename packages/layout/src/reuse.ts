import { VOICE_COUNT } from '@reprise/model';

import type { SystemPlan } from './breaking';
import type { CachedSystem, Cursor } from './cache';
import type { VisibleTrack } from './options';
import { dynamicsBefore } from './staves/dynamics';
import { BAR_REACH } from './staves/staff-module';
import type { Range } from './types';

/**
 * Prefix counts of the bars re-measured in this call: entry `i` counts those before bar `i`, so
 * any span of bars is checked with one subtraction.
 */
export type ChangedBars = Int32Array;

/**
 * No re-measured bar lies within `BAR_REACH` bars of bars `start` to `end` (exclusive), so
 * nothing a staff module reads to draw them has changed, but the dynamic entering `start`.
 */
export function isClean(changed: ChangedBars, start: number, end: number): boolean {
  const last = changed.length - 1;
  const after = changed[Math.min(last, end + BAR_REACH)] ?? 0;
  const before = changed[Math.max(0, start - BAR_REACH)] ?? 0;
  return after === before;
}

/** The dynamic each voice of each visible track last played before bar `index`. */
export function enteringDynamics(tracks: readonly VisibleTrack[], index: number): string {
  const parts: string[] = [];
  for (const { track } of tracks) {
    for (let voice = 0; voice < VOICE_COUNT; voice++) {
      parts.push(dynamicsBefore(track, index, voice));
    }
  }
  return parts.join();
}

export function samePlan(a: SystemPlan, b: SystemPlan): boolean {
  return (
    a.start === b.start &&
    a.end === b.end &&
    a.opensLine === b.opensLine &&
    a.first === b.first &&
    a.indent === b.indent &&
    a.prefix === b.prefix &&
    a.factor === b.factor &&
    a.width === b.width &&
    a.courtesy === b.courtesy
  );
}

export function sameCursor(a: Cursor, b: Cursor): boolean {
  return a.page === b.page && a.x === b.x && a.y === b.y && a.empty === b.empty;
}

const sameRange = (a: Range, b: Range): boolean => a.start === b.start && a.end === b.end;

/**
 * A reused system at its place in the new result. Never mutates what the previous result holds:
 * the system keeps its object while its index and ranges hold, and its anchors are copied only
 * when systems before it were added or removed.
 */
export function reposition(
  entry: CachedSystem,
  index: number,
  primitives: Range,
  anchors: Range,
): CachedSystem {
  const { system } = entry;
  if (
    system.index === index &&
    sameRange(system.primitives, primitives) &&
    sameRange(system.anchors, anchors)
  ) {
    return entry;
  }
  return {
    ...entry,
    system: { ...system, index, primitives, anchors },
    anchors:
      system.index === index
        ? entry.anchors
        : entry.anchors.map((anchor) => ({ ...anchor, system: index })),
  };
}
