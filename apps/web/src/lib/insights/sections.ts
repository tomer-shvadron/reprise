import type { KeySignature } from '@reprise/model';

import { pitchHistogram } from './histogram';
import { detectKey, onsetCount, type Confidence } from './key';
import { keyName, scaleName, type KeyQuality } from './key-names';
import { NOTE_FLAG, type NoteTable } from './note-table';
import type { SongOutline } from './outline';
import { rowsByBar, rowsInBars, subTable } from './rows';
import { fitScale } from './scale-fit';
import type { ScaleId } from './scales';

export interface SectionSpan {
  name: string;
  /** First and last master bar, inclusive. */
  fromBar: number;
  toBar: number;
}

/** The tonic and mode the scales of a stretch are fitted against. */
export interface Tonality {
  tonic: number;
  quality: KeyQuality | 'none';
}

/** Fewer notes than this and a track in a section has no scale of its own. */
export const MIN_TRACK_NOTES = 8;
/** A section named like this is a solo, whatever its texture (the fallback to `soloTrack`). */
export const SOLO_NAME = /\bsolos?\d*\b/i;
/** A track solos where this share of its notes are single notes (not chords) and it is the busiest. */
export const SOLO_SINGLE_SHARE = 0.8;

/**
 * The file's sections as bar spans, each running to the bar before the next section mark. Bars
 * before the first mark form a "Start" span; a file with no marks has none.
 */
export function sectionSpans(outline: Pick<SongOutline, 'bars'>): SectionSpan[] {
  const spans: SectionSpan[] = [];
  outline.bars.forEach((bar, index) => {
    if (bar.section !== undefined) {
      const last = spans[spans.length - 1];
      if (last) last.toBar = index - 1;
      spans.push({ name: bar.section, fromBar: index, toBar: outline.bars.length - 1 });
    } else if (spans.length === 0 && index === 0) {
      spans.push({ name: 'Start', fromBar: 0, toBar: outline.bars.length - 1 });
    }
  });
  return spans.some((span) => span.name !== 'Start') || spans.length > 1 ? spans : [];
}

export interface TrackScale {
  /** Index into `Score.tracks`. */
  track: number;
  notes: number;
  /** `tonic` is the pitch class the scale was fitted on, so a fretboard overlay marks the same root. */
  scale?: { id: ScaleId; name: string; coverage: number; tonic: number };
  /** The track solos here (`soloTrack`): mostly single notes and the busiest part. */
  solo: boolean;
}

export interface SectionInsight extends SectionSpan {
  /** The section's name says it is a solo (`SOLO_NAME`), or one of its tracks solos (`TrackScale.solo`). */
  solo: boolean;
  seconds: number;
  key?: { name: string; tonic: number; quality: KeyQuality | 'none'; confidence: Confidence };
  scale?: { id: ScaleId; name: string; coverage: number };
  tracks: TrackScale[];
}

const onsets = (table: NoteTable, i: number): boolean =>
  !((table.flags[i] ?? 0) & (NOTE_FLAG.dead | NOTE_FLAG.tie | NOTE_FLAG.grace));

/** Struck notes per track in `table`: ties, dead and grace notes start none. */
function noteCounts(table: NoteTable): Map<number, { notes: number; rows: number[] }> {
  const tracks = new Map<number, { notes: number; rows: number[] }>();
  for (let i = 0; i < table.length; i++) {
    const track = table.track[i] ?? 0;
    const entry = tracks.get(track) ?? { notes: 0, rows: [] };
    entry.rows.push(i);
    if (onsets(table, i)) entry.notes++;
    tracks.set(track, entry);
  }
  return tracks;
}

/** Of the struck notes in `rows`, how many sound alone on their beat, and the median pitch. */
function texture(table: NoteTable, rows: readonly number[]): { singles: number; median: number } {
  const perBeat = new Map<number, number>();
  const pitches: number[] = [];
  for (const i of rows) {
    if (!onsets(table, i)) continue;
    const beat = table.beat[i] ?? 0;
    perBeat.set(beat, (perBeat.get(beat) ?? 0) + 1);
    pitches.push(table.pitch[i] ?? 0);
  }
  let singles = 0;
  for (const count of perBeat.values()) if (count === 1) singles++;
  pitches.sort((a, b) => a - b);
  return { singles, median: pitches[Math.floor(pitches.length / 2)] ?? 0 };
}

/**
 * The track that solos in `parts` (track, struck notes, single notes, median pitch): the strictly
 * busiest of at least two parts, with `SOLO_SINGLE_SHARE` of its notes single, and not the lowest
 * part (a bass line of eighths is the busiest part of many songs and no solo). A tie gives none.
 */
export function soloTrack(
  parts: readonly { track: number; notes: number; singles: number; median: number }[],
): number | undefined {
  if (parts.length < 2) return undefined;
  const ordered = [...parts].sort((a, b) => b.notes - a.notes);
  const [busiest, next] = ordered;
  if (!busiest || !next || busiest.notes === next.notes) return undefined;
  if (busiest.singles < SOLO_SINGLE_SHARE * busiest.notes) return undefined;
  const lowest = Math.min(...parts.map((part) => part.median));
  return busiest.median > lowest ? busiest.track : undefined;
}

/** The scale of every track that plays in `table`, fitted on `tonality`. */
export function trackScales(
  table: NoteTable,
  tonality: Tonality | undefined,
  fileKey?: KeySignature,
): TrackScale[] {
  const result: TrackScale[] = [];
  const parts: { track: number; notes: number; singles: number; median: number }[] = [];
  for (const [track, { notes, rows }] of [...noteCounts(table)].sort((a, b) => a[0] - b[0])) {
    if (notes < MIN_TRACK_NOTES) continue;
    parts.push({ track, notes, ...texture(table, rows) });
    const entry: TrackScale = { track, notes, solo: false };
    if (tonality) {
      const histogram = pitchHistogram(subTable(table, rows), { bass: false });
      const fit = fitScale(histogram, tonality.tonic, tonality.quality);
      if (fit) {
        entry.scale = {
          id: fit.scale,
          name: scaleName(tonality.tonic, fit.scale, fileKey),
          coverage: fit.coverage,
          tonic: tonality.tonic,
        };
      }
    }
    result.push(entry);
  }
  const soloing = soloTrack(parts);
  for (const entry of result) entry.solo = entry.track === soloing;
  return result;
}

/** One entry per section: its key and scale, and the scale each track plays in it. */
export function sectionInsights(
  table: NoteTable,
  outline: SongOutline,
  main: Tonality | undefined,
): SectionInsight[] {
  const spans = sectionSpans(outline);
  if (spans.length === 0) return [];
  const bars = rowsByBar(table, outline.bars.length);
  return spans.map((span) => {
    const sub = subTable(table, rowsInBars(bars, span.fromBar, span.toBar));
    const fileKey = outline.bars[span.fromBar]?.keySignature;
    const key = onsetCount(sub) > 0 ? detectKey(sub, fileKey ? { fileKey } : {}) : undefined;
    const found = key?.found ? key : undefined;
    const tonality: Tonality | undefined = found
      ? { tonic: found.tonic, quality: found.quality }
      : main;
    let seconds = 0;
    for (let bar = span.fromBar; bar <= span.toBar; bar++)
      seconds += outline.bars[bar]?.seconds ?? 0;
    const insight: SectionInsight = {
      ...span,
      solo: false,
      seconds,
      tracks: trackScales(sub, tonality, fileKey),
    };
    insight.solo = SOLO_NAME.test(span.name) || insight.tracks.some((track) => track.solo);
    if (found) {
      insight.key = {
        name: keyName(found.tonic, found.quality, fileKey),
        tonic: found.tonic,
        quality: found.quality,
        confidence: found.confidence,
      };
      if (found.scale) {
        insight.scale = {
          id: found.scale.scale,
          name: scaleName(found.tonic, found.scale.scale, fileKey),
          coverage: found.scale.coverage,
        };
      }
    }
    return insight;
  });
}
