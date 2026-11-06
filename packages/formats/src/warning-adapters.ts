import { formatPath } from '@reprise/model';
import type { NativePath, ParseWarning, ViolationPath, ViolationRule } from '@reprise/model';

import type { GpifDropped } from './gpif/dropped';
import type { GpifWarning, GpifWarningCode } from './gpif/warnings';
import type { Warning, WarningLocation, WarningSeverity } from './warnings';

type GpifReaderCode = Exclude<GpifWarningCode, ViolationRule>;

/** Exhaustive, so a new gpif code fails to compile until it is given a severity. */
export const GPIF_SEVERITY: Readonly<Record<GpifReaderCode, WarningSeverity>> = {
  'voice-dropped': 'error',
  'unknown-element': 'warning',
  'unknown-value': 'warning',
  'invalid-value': 'warning',
  'missing-reference': 'warning',
  'multiple-staves': 'warning',
  'simile-expanded': 'warning',
  'grace-without-beat': 'warning',
  'grace-duration-clamped': 'warning',
  'grace-tie-released': 'warning',
  'hammer-pull-without-destination': 'warning',
  'tempo-moved': 'warning',
  'automation-dropped': 'warning',
  'default-tempo': 'warning',
  'not-modelled': 'info',
  'long-note-tied': 'info',
  'drum-articulation': 'info',
};

function isGpifReaderCode(code: GpifWarningCode): code is GpifReaderCode {
  return Object.hasOwn(GPIF_SEVERITY, code);
}

/** The inverse of the model's `formatPath`: `tracks[0].bars[1]` is `['tracks', 0, 'bars', 1]`. */
export function parseModelPath(text: string): ViolationPath {
  const path: ViolationPath = [];
  for (const match of text.matchAll(/\[(\d+)\]|([^.[\]]+)/g)) {
    const [, index, key] = match;
    if (index !== undefined) path.push(Number(index));
    else if (key !== undefined) path.push(key);
  }
  return path;
}

function withoutScoreRoot(path: NativePath): NativePath {
  return path[0] === 'score' ? path.slice(1) : path;
}

function folded(count: number): { count?: number } {
  return count > 1 ? { count } : {};
}

/** A binary reader warning in the shape every other format gives: `count` only above 1. */
export function withFoldedCount(warning: Warning): Warning {
  const { count, ...rest } = warning;
  return { ...rest, ...folded(count ?? 1) };
}

export function fromGpifWarning(warning: GpifWarning): Warning {
  const { code, message, path, count } = warning;
  if (isGpifReaderCode(code)) {
    return {
      code,
      severity: GPIF_SEVERITY[code],
      message,
      location: { element: path },
      ...folded(count),
    };
  }
  return {
    code,
    severity: 'warning',
    message,
    location: { path: withoutScoreRoot(parseModelPath(path)) },
    ...folded(count),
  };
}

/** Every export loss is a `warning`: what goes missing is the user's own score feature. */
export function fromGpifDropped(dropped: GpifDropped): Warning {
  const { code, message, path, count } = dropped;
  return {
    code,
    severity: 'warning',
    message,
    location: { path: withoutScoreRoot(parseModelPath(path)) },
    ...folded(count),
  };
}

/** A score field keeps its score path; an envelope field (`app.extra`) is named in `element`. */
export function fromParseWarning(warning: ParseWarning): Warning {
  const [root, ...rest] = warning.path;
  const location: WarningLocation =
    root === 'score' ? { path: rest } : { element: formatPath(warning.path) };
  return { code: warning.code, severity: 'warning', message: warning.message, location };
}
