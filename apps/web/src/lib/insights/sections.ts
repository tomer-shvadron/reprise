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
/** A track is playing a lead when this share of its beats in the section are single notes and it has the most beats. */
export const SOLO_SINGLE_SHARE = 0.8;
export const SOLO_NAME = /solo|lead/i;

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
  scale?: { id: ScaleId; name: string; coverage: number };
  /** The track plays the lead here: see `SOLO_SINGLE_SHARE`. */
  solo: boolean;
}

export interface SectionInsight extends SectionSpan {
  seconds: number;
  key?: { name: string; tonic: number; quality: KeyQuality | 'none'; confidence: Confidence };
  scale?: { id: ScaleId; name: string; coverage: number };
  tracks: TrackScale[];
}

const onsets = (table: NoteTable, i: number): boolean =>
  !((table.flags[i] ?? 0) & (NOTE_FLAG.dead | NOTE_FLAG.tie | NOTE_FLAG.grace));

/** Per track in a table: onset notes, and how many of the beats hold a single note. */
function trackShapes(
  table: NoteTable,
): Map<number, { notes: number; beats: number; single: number }> {
  const perBeat = new Map<number, { track: number; notes: number }>();
  for (let i = 0; i < table.length; i++) {
    if (!onsets(table, i)) continue;
    const beat = table.beat[i] ?? 0;
    const known = perBeat.get(beat);
    if (known) known.notes++;
    else perBeat.set(beat, { track: table.track[i] ?? 0, notes: 1 });
  }
  const shapes = new Map<number, { notes: number; beats: number; single: number }>();
  for (const { track, notes } of perBeat.values()) {
    const shape = shapes.get(track) ?? { notes: 0, beats: 0, single: 0 };
    shape.notes += notes;
    shape.beats++;
    if (notes === 1) shape.single++;
    shapes.set(track, shape);
  }
  return shapes;
}

/** The scale of every track that plays in `table`, fitted on `tonality`. */
export function trackScales(
  table: NoteTable,
  tonality: Tonality | undefined,
  trackNames: readonly string[],
  fileKey?: KeySignature,
): TrackScale[] {
  const shapes = trackShapes(table);
  const busiest = Math.max(0, ...[...shapes.values()].map((shape) => shape.beats));
  const playing = [...shapes.values()].filter((shape) => shape.notes >= MIN_TRACK_NOTES).length;
  const byTrack = new Map<number, number[]>();
  for (let i = 0; i < table.length; i++) {
    const track = table.track[i] ?? 0;
    const rows = byTrack.get(track);
    if (rows) rows.push(i);
    else byTrack.set(track, [i]);
  }
  const result: TrackScale[] = [];
  for (const [track, rows] of [...byTrack].sort((a, b) => a[0] - b[0])) {
    const shape = shapes.get(track);
    if (!shape || shape.notes < MIN_TRACK_NOTES) continue;
    const solo =
      SOLO_NAME.test(trackNames[track] ?? '') ||
      (playing >= 2 && shape.beats === busiest && shape.single / shape.beats >= SOLO_SINGLE_SHARE);
    const entry: TrackScale = { track, notes: shape.notes, solo };
    if (tonality) {
      const histogram = pitchHistogram(subTable(table, rows), { bass: false });
      const fit = fitScale(histogram, tonality.tonic, tonality.quality);
      if (fit) {
        entry.scale = {
          id: fit.scale,
          name: scaleName(tonality.tonic, fit.scale, fileKey),
          coverage: fit.coverage,
        };
      }
    }
    result.push(entry);
  }
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
  const trackNames = outline.tracks.map((track) => track.name);
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
      seconds,
      tracks: trackScales(sub, tonality, trackNames, fileKey),
    };
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
