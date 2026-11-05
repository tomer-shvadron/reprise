import type { Note } from './note';
import type { Track } from './track';

/** How many master bars before its own a tie may reach back, as in alphaTab. */
export const TIE_REACH_BARS = 3;

export interface TiePosition {
  bar: number;
  voice: number;
  beat: number;
}

export interface TieLink {
  note: Note;
  bar: number;
  beat: number;
}

/**
 * The slot a note occupies in a beat: its string on fretted tracks, its MIDI note on drum and
 * pitched tracks. `setNote` merges over the note in a slot, and a tie joins notes in one slot.
 */
export function sameSlot(
  track: Pick<Track, 'kind'>,
  a: Pick<Note, 'string' | 'fret'>,
  b: Pick<Note, 'string' | 'fret'>,
): boolean {
  return track.kind === 'fretted' ? a.string === b.string : a.fret === b.fret;
}

/**
 * The note a tied note at `at` continues: the most recent note in its slot in the same voice,
 * searching back from the previous beat to the start of the bar `TIE_REACH_BARS` before its own.
 * Rests and notes in other slots are passed over; grace notes are never origins.
 */
export function tieOriginOf(
  track: Pick<Track, 'kind' | 'bars'>,
  at: TiePosition,
  note: Pick<Note, 'string' | 'fret'>,
): TieLink | undefined {
  const floor = Math.max(0, at.bar - TIE_REACH_BARS);
  let from = at.beat - 1;
  for (let bar = at.bar; bar >= floor; bar--) {
    const beats = track.bars[bar]?.voices[at.voice]?.beats ?? [];
    for (let i = Math.min(from, beats.length - 1); i >= 0; i--) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const origin = beat.notes.find((candidate) => sameSlot(track, candidate, note));
      if (origin) return { note: origin, bar, beat: i };
    }
    from = Number.POSITIVE_INFINITY;
  }
  return undefined;
}

/** A tie holds when its origin exists and sounds the same pitch (`tie-target` and `tie-pitch`). */
export function hasTieOrigin(
  track: Pick<Track, 'kind' | 'bars'>,
  at: TiePosition,
  note: Pick<Note, 'string' | 'fret'>,
): boolean {
  return tieOriginOf(track, at, note)?.note.fret === note.fret;
}

/** The next note in `note`'s slot that could take it as tie origin, the inverse of `tieOriginOf`. */
function nextInSlot(
  track: Pick<Track, 'kind' | 'bars'>,
  voice: number,
  from: TieLink,
): TieLink | undefined {
  const ceiling = from.bar + TIE_REACH_BARS;
  let start = from.beat + 1;
  for (let bar = from.bar; bar <= ceiling && bar < track.bars.length; bar++) {
    const beats = track.bars[bar]?.voices[voice]?.beats ?? [];
    for (let i = start; i < beats.length; i++) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const next = beat.notes.find((candidate) => sameSlot(track, candidate, from.note));
      if (next) return { note: next, bar, beat: i };
    }
    start = 0;
  }
  return undefined;
}

/**
 * The notes that continue `note` through ties, in order: each the next note in its slot, tied and
 * on the same fret, whose origin by `tieOriginOf` is the link before it. Read before the origin's
 * pitch changes.
 */
export function tieChainOf(
  track: Pick<Track, 'kind' | 'bars'>,
  at: TiePosition,
  note: Note,
): TieLink[] {
  const chain: TieLink[] = [];
  let link: TieLink = { note, bar: at.bar, beat: at.beat };
  for (;;) {
    const next = nextInSlot(track, at.voice, link);
    if (!next?.note.tie || next.note.fret !== link.note.fret) return chain;
    chain.push(next);
    link = next;
  }
}
