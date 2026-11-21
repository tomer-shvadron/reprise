import { PPQ, type TrackKind } from '@reprise/model';

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
 * a span of 3 frets is the comfortable hand, 5 a real reach. Speed, stretch and fret are read at
 * `PERCENTILE`, not at the maximum, so one slide, one high note or one quick fill does not set them.
 */
export const BANDS: Record<FactorId, readonly [number, number, number, number]> = {
  speed: [2, 4, 6, 9],
  shifts: [4, 10, 20, 40],
  stretch: [2, 3, 4, 5],
  techniques: [0.01, 0.05, 0.15, 0.3],
  fret: [7, 12, 15, 19],
};

/**
 * The weighted mean of the bands, relative weights. Speed counts seven times as much as any other
 * factor: it is what makes a part hard at tempo, and a fast line in one position has little else
 * to be hard about (no shifts, a small stretch, no tricks) but still rates 4.
 */
export const WEIGHTS: Record<FactorId, number> = {
  speed: 7,
  shifts: 1,
  stretch: 1,
  techniques: 1,
  fret: 1,
};

/** Speed, stretch and fret are read at this percentile of their samples, not at the maximum. */
export const PERCENTILE = 0.9;
/** A span of more than this many frets is a shift of position, counted there and not as a stretch. */
export const MAX_STRETCH_FRETS = 5;

export function percentile(values: readonly number[], share: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return (
    sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))] ?? 0
  );
}

/** A strummed chord counts this much of a single note in the speed: raking six strings is not six notes. */
export const CHORD_SPEED_SHARE = 0.4;
/** From this many notes at once a beat is a chord. */
export const CHORD_NOTES = 3;
/** The stretch is the widest span of frets within this many ticks of consecutive notes: a quarter note. */
export const STRETCH_WINDOW_TICKS = PPQ;
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
  /** Notes struck at once. */
  notes: number;
  /** Frets above the nut. */
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
  const fretValues: number[] = [];
  for (let i = 0; i < track.length; i++) {
    if ((track.flags[i] ?? 0) & (NOTE_FLAG.dead | NOTE_FLAG.tie | NOTE_FLAG.grace)) continue;
    notes++;
    if ((track.tech[i] ?? 0) & DEMANDING) demanding++;
    const index = track.beat[i] ?? 0;
    let beat = beats.get(index);
    if (!beat) {
      beat = { bar: track.bar[i] ?? 0, onset: track.onset[i] ?? 0, notes: 0, frets: [] };
      beats.set(index, beat);
    }
    beat.notes++;
    const fret = track.fret[i] ?? 0;
    if (fret > 0) {
      beat.frets.push(fret);
      fretValues.push(fret);
    }
  }
  if (notes < MIN_RATED_NOTES) return undefined;

  const ordered = [...beats.values()].sort((a, b) => a.bar - b.bar || a.onset - b.onset);
  const perBar = new Map<number, number>();
  for (const beat of ordered) {
    const weight = beat.notes >= CHORD_NOTES ? CHORD_SPEED_SHARE : 1;
    perBar.set(beat.bar, (perBar.get(beat.bar) ?? 0) + weight);
  }
  const barStart: number[] = [];
  let ticks = 0;
  for (const bar of outline.bars) {
    barStart.push(ticks);
    ticks += bar.ticks;
  }
  const tickOf = (beat: Beat): number => (barStart[beat.bar] ?? 0) + beat.onset;

  // Onsets a second over every two bars in a row, at the written tempo; the part's speed is the
  // 90th percentile of them.
  const rates: number[] = [];
  for (const [bar, count] of perBar) {
    const next = outline.bars[bar + 1];
    const here = outline.bars[bar];
    const seconds = (here?.passSeconds ?? 0) + (next?.passSeconds ?? 0);
    if (seconds > 0) rates.push((count + (perBar.get(bar + 1) ?? 0)) / seconds);
  }
  const speed = percentile(rates, PERCENTILE);

  const factors: Factor[] = [
    { id: 'speed', value: speed, unit: 'notes per second', band: bandOf(speed, BANDS.speed) },
  ];
  if (kind === 'fretted') {
    let shifts = 0;
    const spans: number[] = [];
    let previous: number | undefined;
    const fretted = ordered.filter((beat) => beat.frets.length > 0);
    fretted.forEach((beat, index) => {
      const lowest = Math.min(...beat.frets);
      if (previous !== undefined && Math.abs(lowest - previous) > SHIFT_FRETS) shifts++;
      previous = lowest;
      // The hand spans the notes of this beat and of the beats that follow within a quarter note.
      let low = lowest;
      let high = Math.max(...beat.frets);
      for (let next = index + 1; next < fretted.length; next++) {
        const other = fretted[next];
        if (!other || tickOf(other) - tickOf(beat) >= STRETCH_WINDOW_TICKS) break;
        low = Math.min(low, ...other.frets);
        high = Math.max(high, ...other.frets);
      }
      if (high - low <= MAX_STRETCH_FRETS) spans.push(high - low);
    });
    const stretch = percentile(spans, PERCENTILE);
    const highest = percentile(fretValues, PERCENTILE);
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
      { id: 'fret', value: highest, unit: 'fret reached', band: bandOf(highest, BANDS.fret) },
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
