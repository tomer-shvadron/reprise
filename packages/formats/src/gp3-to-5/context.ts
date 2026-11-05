import type { Note } from '@reprise/model';

import type { BinaryReader } from '../binary/binary-reader';
import type { WarningLocation, WarningLog } from '../warnings';
import type { GpVersion } from './version';

/** What the reader learns about a note that the model does not keep, for the finishing pass. */
export interface NoteFacts {
  offset: number;
  /** GP flags the origin of a hammer-on or pull-off; the model flags the destination. */
  hammerOrigin: boolean;
  /** GP5's "swap accidentals": spell the note's enharmonic. */
  swapAccidentals: boolean;
}

export interface Context {
  reader: BinaryReader;
  version: GpVersion;
  log: WarningLog;
  noteFacts: WeakMap<Note, NoteFacts>;
}

/** Replaces an out-of-range value and says so. */
export function invalid(
  context: Context,
  location: WarningLocation,
  what: string,
  value: number,
  replacement: number | string,
): void {
  context.log.warn(
    'invalid-value',
    `${what} ${String(value)} is out of range; read as ${String(replacement)}`,
    location,
  );
}

/** Guitar Pro's mixer scale is 0 to 16; the model's is MIDI's 0 to 127, in steps of 8. */
export function controllerValue(
  context: Context,
  raw: number,
  what: string,
  location: WarningLocation,
): number {
  if (raw < 0 || raw > 16) {
    const clamped = Math.min(16, Math.max(0, raw));
    invalid(context, location, what, raw, Math.min(127, clamped * 8));
    return Math.min(127, clamped * 8);
  }
  return Math.min(127, raw * 8);
}
