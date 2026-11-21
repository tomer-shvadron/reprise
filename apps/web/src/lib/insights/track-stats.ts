import type { KeySignature, TrackKind } from '@reprise/model';

import { spellPitchClass } from '../chords';
import { difficultyOf, type Difficulty } from './difficulty';
import { NOTE_FLAG, TECH, type NoteTable, type TechName } from './note-table';
import type { DrumUse, SongOutline } from './outline';
import { subTable } from './rows';
import type { TrackScale } from './sections';

/** The techniques a track card lists. */
export const TOP_TECHNIQUES = 6;
/** The hand covers this many frets: a position is the window holding the most notes. */
export const POSITION_FRETS = 4;

export interface TrackStats {
  /** Index into `Score.tracks`. */
  track: number;
  name: string;
  kind: TrackKind;
  /** Notes struck, ties and dead notes not counted. */
  notes: number;
  /** Sounding pitches, spelled for the key: `E2` to `B♭5`. */
  range?: { low: number; high: number; lowName: string; highName: string };
  /** Fretted tracks: the highest fret, the lowest above the nut, and the busiest window of the neck. */
  frets?: { lowest: number; highest: number; position?: { from: number; to: number } };
  /** Notes (beats, for beat effects) per technique, most used first, at most `TOP_TECHNIQUES`. */
  techniques: { name: TechName; count: number }[];
  /** The scale the track plays across the whole song. */
  scale?: TrackScale['scale'];
  drums?: { notes: number; top: DrumUse[] };
  difficulty?: Difficulty;
}

/** A MIDI pitch as a spelled name with its octave, middle C being C4. */
export function pitchName(pitch: number, key: KeySignature): string {
  return `${spellPitchClass(pitch % 12, key, true)}${String(Math.floor(pitch / 12) - 1)}`;
}

const TECH_NAMES = Object.keys(TECH) as TechName[];

function positionOf(frets: readonly number[]): { from: number; to: number } | undefined {
  const above = frets.filter((fret) => fret > 0);
  if (above.length === 0) return undefined;
  const low = Math.min(...above);
  const high = Math.max(...above);
  let best = { from: low, count: 0 };
  for (let from = low; from <= Math.max(low, high - POSITION_FRETS + 1); from++) {
    const count = above.filter((fret) => fret >= from && fret < from + POSITION_FRETS).length;
    if (count > best.count) best = { from, count };
  }
  return { from: best.from, to: best.from + POSITION_FRETS - 1 };
}

/** The range, techniques and difficulty of every track; `scales` are the whole-song scales from `trackScales`. */
export function trackStats(
  table: NoteTable,
  outline: SongOutline,
  key: KeySignature,
  scales: readonly TrackScale[],
): TrackStats[] {
  const rowsOf = new Map<number, number[]>();
  for (let i = 0; i < table.length; i++) {
    const track = table.track[i] ?? 0;
    const rows = rowsOf.get(track);
    if (rows) rows.push(i);
    else rowsOf.set(track, [i]);
  }
  return outline.tracks.map((info, track) => {
    const stats: TrackStats = {
      track,
      name: info.name,
      kind: info.kind,
      notes: 0,
      techniques: [],
    };
    if (info.drums) {
      stats.notes = info.drums.notes;
      stats.drums = info.drums;
      return stats;
    }
    const rows = rowsOf.get(track) ?? [];
    const counts = new Map<TechName, number>();
    const frets: number[] = [];
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let highest = 0;
    for (const i of rows) {
      const flags = table.flags[i] ?? 0;
      if (flags & NOTE_FLAG.dead) continue;
      const pitch = table.pitch[i] ?? 0;
      low = Math.min(low, pitch);
      high = Math.max(high, pitch);
      if (flags & (NOTE_FLAG.tie | NOTE_FLAG.grace)) continue;
      stats.notes++;
      const tech = table.tech[i] ?? 0;
      for (const name of TECH_NAMES) {
        if (tech & TECH[name]) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      const fret = table.fret[i] ?? 0;
      highest = Math.max(highest, fret);
      if (info.kind === 'fretted') frets.push(fret);
    }
    if (Number.isFinite(low)) {
      stats.range = {
        low,
        high,
        lowName: pitchName(low, key),
        highName: pitchName(high, key),
      };
    }
    if (info.kind === 'fretted' && frets.length > 0) {
      const above = frets.filter((fret) => fret > 0);
      const position = positionOf(frets);
      stats.frets = {
        lowest: above.length > 0 ? Math.min(...above) : 0,
        highest,
        ...(position ? { position } : {}),
      };
    }
    stats.techniques = [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || TECH_NAMES.indexOf(a.name) - TECH_NAMES.indexOf(b.name))
      .slice(0, TOP_TECHNIQUES);
    const scale = scales.find((entry) => entry.track === track)?.scale;
    if (scale) stats.scale = scale;
    const difficulty = difficultyOf(subTable(table, rows), outline, info.kind);
    if (difficulty) stats.difficulty = difficulty;
    return stats;
  });
}
