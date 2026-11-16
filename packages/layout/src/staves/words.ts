import type { Beat } from '@reprise/model';

import { fitText, textWidth } from '../metrics';
import { text, type LayoutSink } from '../primitives';
import type { LaneBands, LaneRequests } from './lanes';

/**
 * The words a beat carries (chord name, beat text, lyrics), drawn the same way on a tab staff and
 * on a standard or percussion staff that is its track's only staff. In both mode they stay on the
 * tab (ADR-0021).
 */
export const WORDS = {
  size: 1.2,
  chordRow: 2.2,
  textRow: 2,
  lyricRow: 2,
  /** Room between a beat's words and the next onset's, in staff spaces. */
  gap: 0.4,
  /** A word row's baseline above the row's bottom: descenders and a gap from what is below. */
  lift: 0.8,
  /** Room under a lyric row's baseline for descenders, in staff spaces. */
  descent: 0.6,
} as const;

/** The heights, in px, of the word lanes a set of beats asks for; zero for a lane none uses. */
export interface WordRows {
  chord: number;
  text: number;
  lyrics: number;
}

export function wordRows(beats: Iterable<Beat>, space: number): WordRows {
  let chord = false;
  let said = false;
  let lines = 0;
  for (const beat of beats) {
    if (beat.chord) chord = true;
    if (beat.text !== undefined && beat.text !== '') said = true;
    for (const [line, syllable] of (beat.lyrics ?? []).entries()) {
      if (syllable !== '') lines = Math.max(lines, line + 1);
    }
  }
  return {
    chord: chord ? WORDS.chordRow * space : 0,
    text: said ? WORDS.textRow * space : 0,
    lyrics: lines * WORDS.lyricRow * space,
  };
}

/** The lane requests of `rows`, for the lanes the beats use. */
export function wordLanes(rows: WordRows): LaneRequests {
  const lanes: LaneRequests = {};
  if (rows.chord > 0) lanes.chord = rows.chord;
  if (rows.text > 0) lanes.text = rows.text;
  if (rows.lyrics > 0) lanes.lyrics = rows.lyrics;
  return lanes;
}

/**
 * How far a beat's words reach either side of its x, in px. `start` is where a chord name or beat
 * text starts, from the beat's x; syllables are centred on it.
 */
export function wordsExtent(
  beat: Beat,
  start: number,
  space: number,
): { left: number; right: number } {
  const size = WORDS.size * space;
  const gap = WORDS.gap * space;
  let left = 0;
  let right = 0;
  if (beat.chord) right = Math.max(right, start + textWidth(beat.chord.name, size) + gap);
  if (beat.text) right = Math.max(right, start + textWidth(beat.text, size) + gap);
  for (const syllable of beat.lyrics ?? []) {
    const half = textWidth(syllable, size) / 2 + gap;
    left = Math.max(left, half);
    right = Math.max(right, half);
  }
  return { left, right };
}

/**
 * Draws a beat's chord name, beat text and syllables into the bar's word lanes. `limit` is the x
 * its words are cut at, as the system's last bar content ends there.
 */
export function drawWords(
  sink: LayoutSink,
  lanes: LaneBands,
  beat: Beat,
  x: number,
  start: number,
  space: number,
  limit: number,
): void {
  const size = WORDS.size * space;
  const node = beat.id;
  const left = x + start;
  const { chord, lyrics } = beat;
  if (chord && lanes.chord) {
    const y = lanes.chord.bottom - WORDS.lift * space;
    const name = fitText(chord.name, size, limit - left);
    if (name !== '' || chord.name === '') sink.primitives.push(text(name, left, y, size, { node }));
  }
  if (beat.text && lanes.text) {
    const y = lanes.text.bottom - WORDS.lift * space;
    const said = fitText(beat.text, size, limit - left);
    if (said !== '') sink.primitives.push(text(said, left, y, size, { node }));
  }
  for (const [line, syllable] of (lyrics ?? []).entries()) {
    if (syllable === '' || !lanes.lyrics) continue;
    const y = lanes.lyrics.top + (line + 1) * WORDS.lyricRow * space - WORDS.descent * space;
    const sung = fitText(syllable, size, 2 * (limit - x));
    if (sung !== '') sink.primitives.push(text(sung, x, y, size, { anchor: 'middle', node }));
  }
}
