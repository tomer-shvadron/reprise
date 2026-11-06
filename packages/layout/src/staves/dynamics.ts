import {
  VOICE_COUNT,
  beatTicks,
  type Bar,
  type Beat,
  type Dynamics,
  type Id,
  type Track,
} from '@reprise/model';

import { glyphMetrics, type GlyphName } from '../metrics';

/** The precomposed Bravura glyph of each dynamic, the same on every staff. */
export const DYNAMICS_GLYPHS: Readonly<Record<Dynamics, GlyphName>> = {
  ppp: 'dynamicPPP',
  pp: 'dynamicPP',
  p: 'dynamicPiano',
  mp: 'dynamicMP',
  mf: 'dynamicMF',
  f: 'dynamicForte',
  ff: 'dynamicFF',
  fff: 'dynamicFFF',
};

/**
 * Where dynamics stand in their lane: one baseline, the tallest glyph's top `DYNAMICS_DROP` staff
 * spaces under the lane's top, in staff spaces of the glyphs' size.
 */
export const DYNAMICS_DROP = 0.5;

export function dynamicsBaseline(laneTop: number, unit: number): number {
  return laneTop + (DYNAMICS_DROP + glyphMetrics('dynamicForte').bbox.top) * unit;
}

/** Guitar Pro's default: a dynamic is only written where it changes from this. */
export const DEFAULT_DYNAMICS: Dynamics = 'f';

/** The dynamic a beat plays at: its first note's, or none for a rest or empty beat. */
export function beatDynamics(beat: Beat): Dynamics | undefined {
  return beat.rest ? undefined : beat.notes[0]?.dynamics;
}

function voiceBeats(track: Track, barIndex: number, voice: number): readonly Beat[] {
  return track.bars[barIndex]?.voices[voice]?.beats ?? [];
}

const before = new WeakMap<Track, Map<number, Dynamics>>();

/**
 * The dynamic `voice` last played before bar `barIndex`, searching back to the track's start.
 * Memoised per track, so a voice of rests does not walk back to the start for every bar.
 */
export function dynamicsBefore(track: Track, barIndex: number, voice: number): Dynamics {
  let memo = before.get(track);
  if (!memo) {
    memo = new Map();
    before.set(track, memo);
  }
  let start = barIndex - 1;
  let found: Dynamics = DEFAULT_DYNAMICS;
  while (start >= 0) {
    const known = memo.get(start * VOICE_COUNT + voice);
    if (known !== undefined) {
      found = known;
      break;
    }
    start--;
  }
  for (let b = start + 1; b < barIndex; b++) {
    for (const beat of voiceBeats(track, b, voice)) found = beatDynamics(beat) ?? found;
    memo.set(b * VOICE_COUNT + voice, found);
  }
  return found;
}

const shown = new WeakMap<Track, Map<number, ReadonlyMap<Id, Dynamics>>>();

/**
 * The beats of bar `barIndex` that write their dynamic, by beat id. Per voice, a played beat
 * writes it when it differs from the voice's previous played beat, in this bar or any earlier
 * one; a beat that is not written still counts as played. At one onset only the lowest voice
 * writing a dynamic draws it.
 */
export function shownDynamics(track: Track, barIndex: number): ReadonlyMap<Id, Dynamics> {
  let memo = shown.get(track);
  if (!memo) {
    memo = new Map();
    shown.set(track, memo);
  }
  const known = memo.get(barIndex);
  if (known) return known;
  const out = new Map<Id, Dynamics>();
  const taken = new Set<number>();
  for (const [voice, { beats }] of (track.bars[barIndex]?.voices ?? []).entries()) {
    if (beats.length === 0) continue;
    let current = dynamicsBefore(track, barIndex, voice);
    let tick = 0;
    for (const beat of beats) {
      const dynamics = beatDynamics(beat);
      if (dynamics !== undefined && dynamics !== current) {
        const key = Math.round(tick * 1000);
        if (!taken.has(key)) {
          taken.add(key);
          out.set(beat.id, dynamics);
        }
      }
      if (dynamics !== undefined) current = dynamics;
      tick += beatTicks(beat);
    }
  }
  memo.set(barIndex, out);
  return out;
}

/**
 * What `measure` keeps room for, reading the bar alone: each voice's first played beat and every
 * change within the voice. Whatever `shownDynamics` writes is among them.
 */
export function reservedDynamics(bar: Bar): ReadonlySet<Id> {
  const out = new Set<Id>();
  for (const { beats } of bar.voices) {
    let current: Dynamics | undefined;
    for (const beat of beats) {
      const dynamics = beatDynamics(beat);
      if (dynamics === undefined) continue;
      if (dynamics !== current) out.add(beat.id);
      current = dynamics;
    }
  }
  return out;
}
