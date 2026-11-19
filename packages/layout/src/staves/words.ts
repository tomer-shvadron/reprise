import { beatTicks, type Beat, type Track } from '@reprise/model';

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
    if (syllable === '') continue;
    const { sung, hyphen } = sungSyllable(syllable);
    const half = textWidth(sung, size) / 2 + gap;
    left = Math.max(left, half);
    // A hyphen is drawn between this syllable and the next, so it asks for its own width and a gap.
    right = Math.max(right, hyphen ? half + textWidth('-', size) + gap : half);
  }
  return { left, right };
}

/**
 * A syllable as it is sung and whether a hyphen follows it. The hyphen is stored as a trailing
 * `-` (D6 on #192) and drawn on its own, centred between this syllable and the next; a lone `-` is
 * a syllable of its own.
 */
export function sungSyllable(syllable: string): { sung: string; hyphen: boolean } {
  if (syllable.length > 1 && syllable.endsWith('-')) {
    return { sung: syllable.slice(0, -1), hyphen: true };
  }
  return { sung: syllable, hyphen: false };
}

/** A beat of one voice and the x its syllables are centred on. */
export interface WordSpot {
  beat: Beat;
  x: number;
}

/** What follows a syllable: the left edge of the next sung syllable on its line, if one is near. */
export type NextSyllable = (beat: Beat, line: number) => number | undefined;

/**
 * Finds, for a beat and a lyric line, the left edge of the next non-empty syllable of that line in
 * the same voice: later in the bar, else in the system's next bar (`next`). The next bar's beats
 * are read lazily, only for a syllable that finds no successor in its own bar. The next bar's
 * standard-staff `shift` is ignored so that bar is never planned here.
 */
export function syllableLookup(
  voices: () => readonly { voice: number; spots: readonly WordSpot[] }[],
  track: Track,
  barIndex: number,
  next: { onsetX(tick: number): number } | undefined,
  space: number,
): NextSyllable {
  const size = WORDS.size * space;
  // Built on the first hyphen, so a bar without one pays nothing.
  let where: Map<Beat, { voice: number; spots: readonly WordSpot[]; at: number }> | undefined;
  const locate = (beat: Beat) => {
    if (!where) {
      where = new Map();
      for (const { voice, spots } of voices()) {
        for (const [at, spot] of spots.entries()) where.set(spot.beat, { voice, spots, at });
      }
    }
    return where.get(beat);
  };
  const later = new Map<number, readonly WordSpot[]>();
  const following = (voice: number): readonly WordSpot[] => {
    const known = later.get(voice);
    if (known) return known;
    const spots: WordSpot[] = [];
    let tick = 0;
    for (const beat of track.bars[barIndex + 1]?.voices[voice]?.beats ?? []) {
      if (next) spots.push({ beat, x: next.onsetX(tick) });
      tick += beatTicks(beat);
    }
    later.set(voice, spots);
    return spots;
  };
  const sung = (spot: WordSpot, line: number): string | undefined => {
    const syllable = spot.beat.lyrics?.[line];
    return syllable === undefined || syllable === '' ? undefined : sungSyllable(syllable).sung;
  };
  const edge = (spot: WordSpot, line: number): number | undefined => {
    const word = sung(spot, line);
    return word === undefined ? undefined : spot.x - textWidth(word, size) / 2;
  };
  return (beat, line) => {
    const found = locate(beat);
    if (!found) return undefined;
    for (const spot of found.spots.slice(found.at + 1)) {
      const left = edge(spot, line);
      if (left !== undefined) return left;
    }
    if (!next) return undefined;
    for (const spot of following(found.voice)) {
      const left = edge(spot, line);
      if (left !== undefined) return left;
    }
    return undefined;
  };
}

/** Where a beat's words are drawn and how far they may reach. */
export interface WordsAt {
  /** The x syllables are centred on. */
  x: number;
  /** Where a chord name or beat text starts, from `x`. */
  start: number;
  space: number;
  /** The x words are cut at, as the system's last bar content ends there. */
  limit: number;
  nextSyllable?: NextSyllable;
}

/**
 * Draws a beat's chord name, beat text and syllables into the bar's word lanes. A hyphenated
 * syllable gets a hyphen of its own, with `node` but no `lane` so the word field still finds the
 * syllable.
 */
export function drawWords(sink: LayoutSink, lanes: LaneBands, beat: Beat, at: WordsAt): void {
  const { x, start, space, limit } = at;
  const size = WORDS.size * space;
  const node = beat.id;
  const left = x + start;
  const { chord, lyrics } = beat;
  if (chord && lanes.chord) {
    const y = lanes.chord.bottom - WORDS.lift * space;
    const name = fitText(chord.name, size, limit - left);
    if (name !== '' || chord.name === '')
      sink.primitives.push(text(name, left, y, size, { node, lane: 'chord' }));
  }
  if (beat.text && lanes.text) {
    const y = lanes.text.bottom - WORDS.lift * space;
    const said = fitText(beat.text, size, limit - left);
    if (said !== '') sink.primitives.push(text(said, left, y, size, { node, lane: 'text' }));
  }
  for (const [line, syllable] of (lyrics ?? []).entries()) {
    if (syllable === '' || !lanes.lyrics) continue;
    const y = lanes.lyrics.top + (line + 1) * WORDS.lyricRow * space - WORDS.descent * space;
    const word = sungSyllable(syllable);
    // A hyphenated syllable is cut with its ellipsis before its hyphen is ever dropped, so a
    // squeezed last bar never shows `Twin` for `Twin-`.
    const dash = textWidth('-', size);
    const reserved = word.hyphen ? WORDS.gap * space + dash : 0;
    const sung = fitText(word.sung, size, 2 * (limit - x - reserved));
    if (sung === '') continue;
    sink.primitives.push(
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- the lane type is a template over number
      text(sung, x, y, size, { anchor: 'middle', node, lane: `lyric:${line}` }),
    );
    if (!word.hyphen) continue;
    const right = x + textWidth(sung, size) / 2;
    const successor = at.nextSyllable?.(beat, line);
    // With no successor in the system the hyphen goes right after the syllable, as at a line end.
    const hx =
      successor === undefined ? right + WORDS.gap * space + dash / 2 : (right + successor) / 2;
    if (hx + dash / 2 > limit) continue;
    sink.primitives.push(text('-', hx, y, size, { anchor: 'middle', node }));
  }
}
