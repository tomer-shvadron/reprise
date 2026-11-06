import type { ParseWarningCode, ViolationPath, ViolationRule } from '@reprise/model';

import type { GpifWarningCode } from './gpif/warnings';

/**
 * What a reader reports about a file it read anyway. `error` means content was lost (the file
 * ended early, or a structure was unreadable); `warning` means a value was out of range and
 * replaced, or a construct could not be placed; `info` means the file carried something the
 * model does not hold, so a re-export will not reproduce it.
 */
export type WarningSeverity = 'info' | 'warning' | 'error';

export type ReaderWarningCode =
  | 'truncated-file'
  | 'corrupt-file'
  | 'trailing-data'
  | 'invalid-value'
  | 'rse-dropped'
  | 'page-setup-dropped'
  | 'hidden-tempo-dropped'
  | 'song-key-dropped'
  | 'master-reverb-dropped'
  | 'midi-routing-dropped'
  | 'track-flags-dropped'
  | 'beam-grouping-dropped'
  | 'beat-display-dropped'
  | 'ottava-dropped'
  | 'rasgueado-dropped'
  | 'wah-dropped'
  | 'chord-construction-dropped'
  | 'note-duration-dropped'
  | 'bend-vibrato-dropped'
  | 'note-off-string'
  | 'hammer-pull-without-destination'
  | 'tie-without-origin'
  | 'tie-beyond-previous-beat'
  | 'lyrics-unplaced';

/**
 * A reader code, or a `validateScore` rule the finished score breaks. `read` reports the gpif
 * and native codes under the same type.
 */
export type WarningCode = ReaderWarningCode | GpifWarningCode | ParseWarningCode | ViolationRule;

/** Where in the file, and where in the parsed score, a warning applies; any part may be absent. */
export interface WarningLocation {
  /** Byte offset in the file where the construct starts. */
  offset?: number;
  /** 0-based indices into the parsed score. */
  track?: number;
  bar?: number;
  voice?: number;
  beat?: number;
  /**
   * Path from the score root, for invariant violations; from the document root for a native
   * envelope field (`['app', 'extra']`).
   */
  path?: ViolationPath;
  /** The gpif element a gp or gpx warning is about, `Notes/Note[3]/Properties/Property[Slide]`. */
  element?: string;
}

export interface Warning {
  code: WarningCode;
  severity: WarningSeverity;
  message: string;
  location: WarningLocation;
  /** How many times a folded warning occurred; only its first location is kept. */
  count?: number;
}

/**
 * Collects warnings for one read. `info` warnings are folded by code, since a file carries the
 * same unmodelled construct on many beats and one entry with a count says it all.
 */
export class WarningLog {
  private readonly entries: Warning[] = [];
  private readonly folded = new Map<WarningCode, Warning>();

  add(
    code: WarningCode,
    severity: WarningSeverity,
    message: string,
    location: WarningLocation,
  ): void {
    if (severity === 'info') {
      const existing = this.folded.get(code);
      if (existing) {
        existing.count = (existing.count ?? 1) + 1;
        return;
      }
      const warning: Warning = { code, severity, message, location, count: 1 };
      this.folded.set(code, warning);
      this.entries.push(warning);
      return;
    }
    this.entries.push({ code, severity, message, location });
  }

  info(code: ReaderWarningCode, message: string, location: WarningLocation): void {
    this.add(code, 'info', message, location);
  }

  warn(code: ReaderWarningCode, message: string, location: WarningLocation): void {
    this.add(code, 'warning', message, location);
  }

  list(): Warning[] {
    return [...this.entries];
  }
}
