import { openStringPitch, type Beat, type Note, type Track } from '@reprise/model';

import type { ClipTrack } from './clipboard-format';

type NeckTrack = Pick<Track, 'tuning' | 'fretCount'>;

export interface Refingered {
  track: ClipTrack;
  /** Notes (grace notes too) that sound nowhere on the target neck, or collide, and were left out. */
  dropped: number;
}

interface Position {
  string: number;
  fret: number;
}

/** Where `pitch` can be played on the target's neck, the note's own string first, then the lowest fret. */
function positions(target: NeckTrack, pitch: number, prefer: number): Position[] {
  const found: Position[] = [];
  for (let string = 1; string <= target.tuning.length; string++) {
    const open = openStringPitch(target, string);
    if (open === undefined) continue;
    const fret = pitch - open;
    if (fret >= 0 && fret <= target.fretCount) found.push({ string, fret });
  }
  return found.sort((a, b) => {
    const rank = (p: Position) => (p.string === prefer ? 0 : 1);
    return rank(a) - rank(b) || a.fret - b.fret;
  });
}

/** Distinct strings for every note of a chord, or undefined when none exist; first fit by preference. */
function solve(options: Position[][], at = 0, used = new Set<number>()): Position[] | undefined {
  if (at === options.length) return [];
  for (const position of options[at] ?? []) {
    if (used.has(position.string)) continue;
    used.add(position.string);
    const rest = solve(options, at + 1, used);
    used.delete(position.string);
    if (rest) return [position, ...rest];
  }
  return undefined;
}

/** What a voice carries from beat to beat: which target string each source string ended on. */
type Ties = Map<number, number>;

/**
 * Re-fingers one chord: each note keeps its pitch. A note that is a tie takes the string its
 * origin got, so a tie chain stays on one string. Notes that fit nowhere are left out, and when
 * the rest still collide, the last ones are dropped until the chord has a fingering.
 */
function refingerNotes(
  notes: readonly Note[],
  source: NeckTrack,
  target: NeckTrack,
  ties: Ties,
): { notes: Note[]; dropped: number } {
  const candidates = notes.flatMap((note) => {
    const open = openStringPitch(source, note.string);
    if (open === undefined) return [];
    const prefer = (note.tie ? ties.get(note.string) : undefined) ?? note.string;
    return [{ note, options: positions(target, open + note.fret, prefer) }];
  });
  let usable = candidates.filter(({ options }) => options.length > 0);
  let fingering = solve(usable.map(({ options }) => options));
  while (!fingering && usable.length > 0) {
    usable = usable.slice(0, -1);
    fingering = solve(usable.map(({ options }) => options));
  }
  const kept = usable.map(({ note }, i) => ({ ...note, ...fingering?.[i] }));
  // Both ends of a tie stay on one string only when the origin kept it; forget strings that moved.
  for (const note of notes) ties.delete(note.string);
  usable.forEach(({ note }, i) => {
    const position = fingering?.[i];
    if (position) ties.set(note.string, position.string);
  });
  return { notes: kept, dropped: notes.length - kept.length };
}

function refingerBeat(
  beat: Beat,
  source: NeckTrack,
  target: NeckTrack,
  ties: Ties,
): { beat: Beat; dropped: number } {
  const main = refingerNotes(beat.notes, source, target, ties);
  let dropped = main.dropped;
  const grace = beat.grace?.map((ornament) => {
    // An ornament holds no tie, so each of its notes is refingered on its own.
    const result = refingerNotes(ornament.notes, source, target, new Map());
    dropped += result.dropped;
    return { ...ornament, notes: result.notes };
  });
  const emptied = beat.notes.length > 0 && main.notes.length === 0;
  return {
    dropped,
    beat: {
      ...beat,
      notes: main.notes,
      ...(emptied && { rest: true }),
      ...(grace && { grace }),
    },
  };
}

/**
 * The clip's notes for a fretted track with another string count: the same pitches on the
 * target's strings. Frets count from the nut, so a capo changes nothing. A beat that loses every
 * note becomes a rest. Same string count keeps string and fret as they are, so the caller does
 * not come here for it.
 */
export function refinger(clip: ClipTrack, target: NeckTrack): Refingered {
  let dropped = 0;
  const source: NeckTrack = { tuning: clip.tuning, fretCount: clip.fretCount };
  // One tie map per voice, carried across its bars in order.
  const ties = new Map<number, Ties>();
  const bars = clip.bars.map((bar) => ({
    ...bar,
    voices: bar.voices.map((voice) => {
      const carried = ties.get(voice.voice) ?? new Map<number, number>();
      ties.set(voice.voice, carried);
      const beats = voice.beats.map((beat) => {
        const result = refingerBeat(beat, source, target, carried);
        dropped += result.dropped;
        return result.beat;
      });
      return { ...voice, beats };
    }),
  }));
  return {
    dropped,
    track: { ...clip, tuning: [...target.tuning], fretCount: target.fretCount, bars },
  };
}
