import { canShowTab, findTuningName, openStringPitch, type Track } from '@reprise/model';

import { hzFromMidi } from './notes';

export interface StringTarget {
  /** The track's string number, 1 for the highest. */
  string: number;
  midi: number;
  hz: number;
}

export interface StringSet {
  targets: StringTarget[];
  capo: number;
  tuningName: string | undefined;
}

/** The notes the track's strings sound open, with the capo, ordered from the lowest. */
export function stringTargets(
  track:
    | (Pick<Track, 'kind' | 'tuning' | 'capo' | 'courses' | 'drone'> & { program?: number })
    | undefined,
  referenceHz: number,
): StringSet | undefined {
  if (!track || !canShowTab(track)) return undefined;
  const targets: StringTarget[] = [];
  for (let string = 1; string <= track.tuning.length; string += 1) {
    const open = openStringPitch(track, string);
    if (open === undefined) continue;
    const midi = open + track.capo;
    targets.push({ string, midi, hz: hzFromMidi(midi, referenceHz) });
  }
  targets.sort((a, b) => a.midi - b.midi || b.string - a.string);
  return {
    targets,
    capo: track.capo,
    tuningName: findTuningName(track.tuning, {
      courses: track.courses,
      drone: track.drone,
      program: track.program,
    }),
  };
}

export const AUTO_RANGE_CENTS = 300;
/** Another string must be this much nearer before auto leaves the one it is on. */
export const SWITCH_MARGIN_CENTS = 50;

/**
 * The string auto picks for a reading: the nearest target within 300 cents, kept until another
 * is at least 50 cents nearer.
 */
export function pickString(
  targets: readonly StringTarget[],
  midi: number,
  previous: number | undefined,
): StringTarget | undefined {
  let best: StringTarget | undefined;
  for (const target of targets) {
    if (!best || Math.abs(midi - target.midi) < Math.abs(midi - best.midi)) best = target;
  }
  if (!best || Math.abs(midi - best.midi) * 100 > AUTO_RANGE_CENTS) return undefined;
  const kept = targets.find((target) => target.string === previous);
  if (
    kept &&
    Math.abs(midi - kept.midi) * 100 <= AUTO_RANGE_CENTS &&
    (Math.abs(midi - kept.midi) - Math.abs(midi - best.midi)) * 100 < SWITCH_MARGIN_CENTS
  ) {
    return kept;
  }
  return best;
}

/** The lowest note the detector must find: the lowest target, or a floor with no track. */
export const FLOOR_HZ = 30;
export const lowestTargetHz = (set: StringSet | undefined): number => {
  const lowest = set?.targets[0]?.hz;
  return lowest === undefined ? FLOOR_HZ : lowest;
};

/** Highest pitch the detector looks for: above E6, the 24th fret of a high E. */
export const MAX_DETECT_HZ = 1500;
/** A string may be tuned about three semitones flat of its target. */
export const FLAT_ALLOWANCE = 0.84;

/**
 * The analysis window, a power of two. At least 2048, and at least twice the longest lag the
 * detector may look for, so the correlation has two periods of the lowest string to work with.
 */
export function windowFor(sampleRate: number, lowestHz: number): number {
  const tauMax = Math.ceil(sampleRate / (FLAT_ALLOWANCE * lowestHz));
  let size = 2048;
  while (size < 2 * tauMax && size < 8192) size *= 2;
  return size;
}
