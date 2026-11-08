import { VOICE_COUNT } from '@reprise/model';

import type { SystemPlan } from './breaking';
import type { CachedPart, Cursor, PartPlacement } from './cache';
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

/**
 * The keys given, which must be every key of `T`: a field added to `SystemPlan` or `Cursor` fails
 * to compile here rather than letting reuse hand back a system built from a different one.
 */
const everyKey =
  <T>() =>
  <const K extends readonly (keyof T)[]>(
    keys: K & ([Exclude<keyof T, K[number]>] extends [never] ? unknown : never),
  ): K =>
    keys;

const PLAN_KEYS = everyKey<SystemPlan>()([
  'start',
  'end',
  'opensLine',
  'first',
  'indent',
  'prefix',
  'factor',
  'squeeze',
  'trim',
  'width',
  'courtesy',
]);

const CURSOR_KEYS = everyKey<Cursor>()(['page', 'x', 'y', 'empty']);

function sameFields<T>(keys: readonly (keyof T)[], a: T, b: T): boolean {
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

export const samePlan = (a: SystemPlan, b: SystemPlan): boolean => sameFields(PLAN_KEYS, a, b);

const sameCursor = (a: Cursor, b: Cursor): boolean => sameFields(CURSOR_KEYS, a, b);

const sameRange = (a: Range, b: Range): boolean => a.start === b.start && a.end === b.end;

/** The same parts, each at the same place and holding the same staff slots. */
export function samePlacement(a: readonly PartPlacement[], b: readonly PartPlacement[]): boolean {
  return (
    a.length === b.length &&
    a.every((part, i) => {
      const other = b[i];
      return other !== undefined && sameCursor(part, other) && sameRange(part.slots, other.slots);
    })
  );
}

/**
 * A reused part at its place in the new result. Never mutates what the previous result holds:
 * the system keeps its object while its index and ranges hold, and its anchors are copied only
 * when systems before it were added or removed.
 */
export function reposition(
  entry: CachedPart,
  index: number,
  primitives: Range,
  anchors: Range,
): CachedPart {
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
