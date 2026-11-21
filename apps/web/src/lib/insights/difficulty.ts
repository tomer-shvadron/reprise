import type { TrackKind } from '@reprise/model';

import { NOTE_FLAG, TECH, type NoteTable } from './note-table';
import type { SongOutline } from './outline';

export type FactorId = 'speed' | 'shifts' | 'stretch' | 'techniques' | 'fret';

export interface Factor {
  id: FactorId;
  value: number;
  /** What `value` counts, for the card: `notes per second`. */
  unit: string;
  /** 1 (easy) to 5 (hard), from `BANDS`. */
  band: number;
}

export interface Difficulty {
  /** 1 to 5, rough: a heuristic with no published model behind it. */
  rating: number;
  /** The weighted mean of the bands before rounding. */
  score: number;
  factors: Factor[];
}

/**
 * The upper bound of each band 1 to 4; a value past the last is band 5. One table, so a retune is
 * one edit. They are judgement, not measurement: no validated model of guitar difficulty exists, so
 * each reads as "a player at this level can do it": 4 notes a second is a quick eighth-note run at
 * 120 bpm, 9 is a fast sixteenth-note passage; a jump of more than 4 frets is a position shift;
 * a span of 4 frets is the comfortable hand, 7 a real reach.
 */
export const BANDS: Record<FactorId, readonly [number, number, number, number]> = {
  speed: [2, 4, 6, 9],
  shifts: [4, 10, 20, 40],
  stretch: [3, 4, 5, 6],
  techniques: [0.01, 0.05, 0.15, 0.3],
  fret: [7, 12, 15, 19],
};

/** Speed counts most: it is what makes a part hard to play at tempo. Weights are relative. */
export const WEIGHTS: Record<FactorId, number> = {
  speed: 0.35,
  shifts: 0.15,
  stretch: 0.15,
  techniques: 0.2,
  fret: 0.15,
};

/** A jump of more than this many frets between consecutive notes is a shift of position. */
export const SHIFT_FRETS = 4;
/** Fewer notes than this and a track gets no rating. */
export const MIN_RATED_NOTES = 8;

/** Techniques that take real practice: tapping, tremolo picking, hard harmonics and bends of a whole tone or more. */
const DEMANDING = TECH.tapping | TECH.tremoloPicking | TECH.harmonicHard | TECH.bendWide;

export const bandOf = (value: number, bounds: readonly number[]): number => {
  const below = bounds.findIndex((bound) => value <= bound);
  return below === -1 ? 5 : below + 1;
};

interface Beat {
  bar: number;
  onset: number;
  /** Frets above the nut, lowest first. */
  frets: number[];
}

/**
 * The rating of one track, from a table that holds only its rows. Drum tracks and tracks of fewer
 * than `MIN_RATED_NOTES` notes have none. A pitched track has no frets, so only its speed and
 * techniques count.
 */
export function difficultyOf(
  track: NoteTable,
  outline: Pick<SongOutline, 'bars'>,
  kind: TrackKind,
): Difficulty | undefined {
  if (kind === 'drums') return undefined;
  const beats = new Map<number, Beat>();
  let notes = 0;
  let demanding = 0;
  let highest = 0;
  for (let i = 0; i < track.length; i++) {
    if ((track.flags[i] ?? 0) & (NOTE_FLAG.dead | NOTE_FLAG.tie | NOTE_FLAG.grace)) continue;
    notes++;
    if ((track.tech[i] ?? 0) & DEMANDING) demanding++;
    const index = track.beat[i] ?? 0;
    let beat = beats.get(index);
    if (!beat) {
      beat = { bar: track.bar[i] ?? 0, onset: track.onset[i] ?? 0, frets: [] };
      beats.set(index, beat);
    }
    const fret = track.fret[i] ?? 0;
    highest = Math.max(highest, fret);
    if (fret > 0) beat.frets.push(fret);
  }
  if (notes < MIN_RATED_NOTES) return undefined;

  const ordered = [...beats.values()].sort((a, b) => a.bar - b.bar || a.onset - b.onset);
  const perBar = new Map<number, number>();
  for (const beat of ordered) perBar.set(beat.bar, (perBar.get(beat.bar) ?? 0) + 1);

  // Peak onsets a second over any two bars in a row, at the written tempo.
  let speed = 0;
  for (const [bar, count] of perBar) {
    const next = outline.bars[bar + 1];
    const here = outline.bars[bar];
    const seconds = (here?.passSeconds ?? 0) + (next?.passSeconds ?? 0);
    if (seconds <= 0) continue;
    speed = Math.max(speed, (count + (perBar.get(bar + 1) ?? 0)) / seconds);
  }

  const factors: Factor[] = [
    { id: 'speed', value: speed, unit: 'notes per second', band: bandOf(speed, BANDS.speed) },
  ];
  if (kind === 'fretted') {
    let shifts = 0;
    let stretch = 0;
    let previous: number | undefined;
    for (const beat of ordered) {
      const lowest = beat.frets[0] === undefined ? undefined : Math.min(...beat.frets);
      if (lowest === undefined) continue;
      if (previous !== undefined && Math.abs(lowest - previous) > SHIFT_FRETS) shifts++;
      previous = lowest;
      stretch = Math.max(stretch, Math.max(...beat.frets) - lowest);
    }
    const minutes = outline.bars.reduce((sum, bar) => sum + bar.passSeconds, 0) / 60;
    const perMinute = minutes > 0 ? shifts / minutes : 0;
    factors.push(
      {
        id: 'shifts',
        value: perMinute,
        unit: 'position shifts per minute',
        band: bandOf(perMinute, BANDS.shifts),
      },
      { id: 'stretch', value: stretch, unit: 'frets', band: bandOf(stretch, BANDS.stretch) },
    );
    factors.push(
      {
        id: 'techniques',
        value: demanding / notes,
        unit: 'share of notes',
        band: bandOf(demanding / notes, BANDS.techniques),
      },
      { id: 'fret', value: highest, unit: 'highest fret', band: bandOf(highest, BANDS.fret) },
    );
  } else {
    factors.push({
      id: 'techniques',
      value: demanding / notes,
      unit: 'share of notes',
      band: bandOf(demanding / notes, BANDS.techniques),
    });
  }

  const weight = factors.reduce((sum, factor) => sum + WEIGHTS[factor.id], 0);
  const score = factors.reduce((sum, factor) => sum + WEIGHTS[factor.id] * factor.band, 0) / weight;
  return { rating: Math.min(5, Math.max(1, Math.round(score))), score, factors };
}
