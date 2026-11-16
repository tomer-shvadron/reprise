import type { Id, Score } from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { EditCursor } from '@/state/selection';

import { cursorTick } from './cursor';
import type { WordKind } from './words';

const EPSILON = 1e-6;

interface Slot {
  id: Id;
  bar: number;
  tick: number;
}

/**
 * Where a word can go in a track. A chord name or beat text sits on any beat of the voice, a
 * rest included. A syllable sits on a played beat of voice 1 (a rest or an empty beat has no
 * note to sing), which is where Guitar Pro and both readers put them.
 */
function slotsOf(score: Score, trackIndex: number, voice: number, played: boolean): Slot[] {
  const { beats } = scoreIndex(score);
  const slots: Slot[] = [];
  for (const [bar, found] of (score.tracks[trackIndex]?.bars ?? []).entries()) {
    for (const beat of found.voices[voice]?.beats ?? []) {
      if (played && (beat.rest || beat.notes.length === 0)) continue;
      slots.push({ id: beat.id, bar, tick: beats.get(beat.id)?.tick ?? 0 });
    }
  }
  return slots;
}

const before = (a: { bar: number; tick: number }, b: { bar: number; tick: number }) =>
  a.bar !== b.bar ? a.bar < b.bar : a.tick < b.tick - EPSILON;

/** The beat a field opens on at the cursor: its own beat, or for lyrics the played beat at its onset or the next one. */
export function firstWordBeat(score: Score, cursor: EditCursor, kind: WordKind): Id | undefined {
  if (kind !== 'lyric') return cursor.beat;
  const tick = cursorTick(score, cursor);
  if (tick === undefined) return undefined;
  const at = { bar: cursor.at.bar, tick };
  return slotsOf(score, cursor.at.track, 0, true).find((slot) => !before(slot, at))?.id;
}

/** The beat after or before `from` that takes a `kind` of word, in its track; undefined past either end. */
export function nextWordBeat(
  score: Score,
  from: Id,
  kind: WordKind,
  direction: 1 | -1,
): Id | undefined {
  const info = scoreIndex(score).beats.get(from);
  if (!info) return undefined;
  const lyric = kind === 'lyric';
  const slots = slotsOf(score, info.trackIndex, lyric ? 0 : info.voice, lyric);
  const here = { bar: info.masterBarIndex, tick: info.tick };
  if (direction === 1) return slots.find((slot) => before(here, slot))?.id;
  return slots.filter((slot) => before(slot, here)).at(-1)?.id;
}
