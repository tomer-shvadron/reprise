import type { BeatEffects, BendPoint, Vibrato } from '@reprise/model';

import { ARTICULATION } from './parameters';
import type { GainPoint, PlanInput, PlanLink } from './plan';

export type PitchTerm = (time: number) => number;

/** The segments that sound, origin first, and the release once a dead or staccato link cut it. */
export interface TieChain {
  segments: PlanLink[];
  end: number;
  /** A dead or staccato link ended the chain early. */
  cut: boolean;
}

/** Bend and whammy points: position 0 to 60 across `span`, values in quarter tones. */
export function pointsCurve(points: readonly BendPoint[], start: number, span: number): PitchTerm {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  return (time) => {
    const position = span > 0 ? ((time - start) / span) * 60 : 60;
    let previous = sorted[0];
    if (!previous) return 0;
    if (position <= previous.position) return previous.value / 2;
    for (const point of sorted) {
      if (position <= point.position) {
        const width = point.position - previous.position;
        const share = width > 0 ? (position - previous.position) / width : 1;
        return (previous.value + (point.value - previous.value) * share) / 2;
      }
      previous = point;
    }
    return previous.value / 2;
  };
}

export function wider(a: Vibrato, b: Vibrato | undefined): Vibrato {
  if (a === 'wide' || b === 'wide') return 'wide';
  return a === 'slight' || b === 'slight' ? 'slight' : 'none';
}

function ownVibrato(segment: PlanLink): Vibrato {
  return wider(segment.note.vibrato, segment.effects.vibrato);
}

/**
 * Guitar Pro ends a tied note's sound shortly after a dead link and halfway through a staccato
 * one; the links after either are not heard. Drum tracks take no length articulation.
 */
export function tieChain(input: PlanInput, tonal: boolean, end: number): TieChain {
  const segments: PlanLink[] = [
    { note: input.note, effects: input.effects, when: input.when, length: input.beatLength },
  ];
  for (const link of input.links) {
    if (link.when >= end) break;
    if (tonal && link.note.dead) {
      return { segments, end: Math.min(end, link.when + ARTICULATION.dead.length), cut: true };
    }
    segments.push(link);
    if (tonal && link.note.staccato) {
      const cut = link.when + link.length * ARTICULATION.staccatoFraction;
      return { segments, end: Math.min(end, cut), cut: true };
    }
  }
  return { segments, end, cut: false };
}

interface Curve {
  start: number;
  term: PitchTerm;
}

/** The latest curve to have started; 0 before the first. */
function latest(curves: readonly Curve[]): PitchTerm | undefined {
  if (curves.length === 0) return undefined;
  return (time) => {
    let current: PitchTerm | undefined;
    for (const curve of curves) if (curve.start <= time) current = curve.term;
    return current ? current(time) : 0;
  };
}

/**
 * Each bend from its own onset, spanning to the end of the last link before one that bends or
 * vibrates on its own (alphaTab's `extendBendArrowsOnTiedNotes`); its last value holds after.
 */
export function bendTerm(segments: readonly PlanLink[]): PitchTerm | undefined {
  const curves: Curve[] = [];
  for (const [index, segment] of segments.entries()) {
    const bend = segment.note.bend;
    if (!bend) continue;
    let last = segment;
    for (const following of segments.slice(index + 1)) {
      if (following.note.bend || ownVibrato(following) !== 'none') break;
      last = following;
    }
    const span = last.when + last.length - segment.when;
    curves.push({ start: segment.when, term: pointsCurve(bend.points, segment.when, span) });
  }
  return latest(curves);
}

export function whammyTerm(segments: readonly PlanLink[]): PitchTerm | undefined {
  const curves: Curve[] = [];
  for (const { effects, when, length } of segments) {
    if (effects.whammy)
      curves.push({ start: when, term: pointsCurve(effects.whammy.points, when, length) });
  }
  return latest(curves);
}

/** A bare link keeps the vibrato before it; the phase runs on unbroken across links. */
export function vibratoTerm(segments: readonly PlanLink[]): PitchTerm | undefined {
  const curves: Curve[] = [];
  let kind: Vibrato = 'none';
  let phase = 0;
  let previous: number | undefined;
  for (const segment of segments) {
    if (kind !== 'none' && previous !== undefined) {
      phase += 2 * Math.PI * ARTICULATION.vibrato[kind].rate * (segment.when - previous);
    }
    const own = ownVibrato(segment);
    if (own !== 'none') kind = own;
    previous = segment.when;
    if (kind === 'none') continue;
    const { rate, depth } = ARTICULATION.vibrato[kind];
    const start = segment.when;
    const offset = phase;
    curves.push({
      start,
      term: (time) => depth * Math.sin(offset + 2 * Math.PI * rate * (time - start)),
    });
  }
  return latest(curves);
}

/** Fade-in, fade-out and volume swell across `[start, start + length]`. */
export function fadePoints(
  effects: BeatEffects,
  start: number,
  length: number,
): GainPoint[] | undefined {
  const floor = ARTICULATION.fadeFloor;
  const end = start + length;
  if (effects.volumeSwell) {
    return [
      { at: start, db: floor },
      { at: start + length / 2, db: 0 },
      { at: end, db: floor },
    ];
  }
  if (effects.fadeIn) {
    return [
      { at: start, db: floor },
      { at: end, db: 0 },
    ];
  }
  if (effects.fadeOut) {
    return [
      { at: start, db: 0 },
      { at: end, db: floor },
    ];
  }
  return undefined;
}

/**
 * The origin's level shape, then each link's fade or palm mute from its onset, starting from the
 * level there. Lifting the palm does not revive a damped string, so the first mute latches and a
 * later fade runs that much lower.
 */
export function chainGain(segments: readonly PlanLink[], tonal: boolean): GainPoint[] {
  const [origin, ...links] = segments;
  if (!origin) return [];
  const { decayTo, decayTime } = ARTICULATION.palmMute;
  let points = fadePoints(origin.effects, origin.when, origin.length) ?? [];
  let muted = tonal && origin.note.palmMute;
  let damped = 0;
  if (points.length === 0 && muted) {
    points = [
      { at: origin.when, db: 0 },
      { at: origin.when + decayTime, db: decayTo },
    ];
    damped = decayTo;
  }
  for (const link of links) {
    const fade = fadePoints(link.effects, link.when, link.length);
    const mutes = tonal && link.note.palmMute && !muted;
    if (mutes) muted = true;
    if (!fade && !mutes) continue;
    const level = levelAt(points, link.when);
    points = points.filter((point) => point.at <= link.when);
    points.push(
      { at: link.when, db: level },
      ...(fade?.map((point) => ({ at: point.at, db: point.db + damped })) ?? [
        { at: link.when + decayTime, db: level + decayTo },
      ]),
    );
    if (mutes && !fade) damped = decayTo;
  }
  return points;
}

/** The level at `time`, linear in dB between points; at a step, the value after it. */
export function levelAt(points: readonly GainPoint[], time: number): number {
  const first = points[0];
  if (!first) return 0;
  let index = -1;
  for (const [position, point] of points.entries()) if (point.at <= time) index = position;
  const current = points[index];
  if (!current) return first.db;
  const next = points[index + 1];
  if (!next) return current.db;
  return current.db + ((next.db - current.db) * (time - current.at)) / (next.at - current.at);
}
