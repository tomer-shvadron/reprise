import { openStringPitch, type Beat, type Note, type Track } from '@reprise/model';

import type { ClipTrack } from './clipboard-format';

type NeckTrack = Pick<Track, 'tuning' | 'fretCount' | 'capo'>;

export interface Refingered {
  track: ClipTrack;
  /** Notes (grace notes too) that sound nowhere on the target neck, or collide, and were left out. */
  dropped: number;
  /** Trills whose alternate fret fell off the target neck and were removed. */
  trillsDropped: number;
  /** Natural harmonics that moved: their node is a place on the string, so they may now sound wrong. */
  harmonicsMoved: number;
}

interface Position {
  string: number;
  fret: number;
}

interface Counts {
  dropped: number;
  trillsDropped: number;
  harmonicsMoved: number;
}

/**
 * Where `pitch` can be played on the target's neck, frets counting from its capo as the model's
 * `midiNote` does: the preferred string first, then the lowest fret.
 */
function positions(target: NeckTrack, pitch: number, prefer: number | undefined): Position[] {
  const found: Position[] = [];
  for (let string = 1; string <= target.tuning.length; string++) {
    const open = openStringPitch(target, string);
    if (open === undefined) continue;
    const fret = pitch - open - target.capo;
    if (fret >= 0 && fret <= target.fretCount) found.push({ string, fret });
  }
  const rank = (p: Position) => (p.string === prefer ? 0 : 1);
  return found.sort((a, b) => rank(a) - rank(b) || a.fret - b.fret);
}

/** The target string tuned to the same open pitch as `string` of the source, if there is one. */
function sameOpenString(source: NeckTrack, target: NeckTrack, string: number): number | undefined {
  const open = openStringPitch(source, string);
  if (open === undefined) return undefined;
  for (let candidate = 1; candidate <= target.tuning.length; candidate++) {
    if (openStringPitch(target, candidate) === open) return candidate;
  }
  return undefined;
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

/** The note on its new position; the trill moves by the same number of frets, as `transpose` does. */
function moved(note: Note, to: Position, target: NeckTrack, counts: Counts): Note {
  const { trill, ...rest } = note;
  const result: Note = { ...rest, ...to };
  const delta = to.fret - note.fret;
  if (trill) {
    const fret = trill.fret + delta;
    if (fret >= 0 && fret <= target.fretCount) result.trill = { ...trill, fret };
    else counts.trillsDropped += 1;
  }
  if (delta !== 0 && note.harmonic?.kind === 'natural') counts.harmonicsMoved += 1;
  return result;
}

/**
 * Re-fingers one chord: each note keeps its pitch. A note that is a tie takes the string its
 * origin got, so a tie chain stays on one string; any other prefers the string tuned to the same
 * open pitch, then the lowest fret. Notes that fit nowhere are left out, and when the rest still
 * collide, the last ones are dropped until the chord has a fingering.
 */
function refingerNotes(
  notes: readonly Note[],
  source: NeckTrack,
  target: NeckTrack,
  ties: Ties,
  counts: Counts,
): Note[] {
  const candidates = notes.flatMap((note) => {
    const open = openStringPitch(source, note.string);
    if (open === undefined) return [];
    const prefer =
      (note.tie ? ties.get(note.string) : undefined) ?? sameOpenString(source, target, note.string);
    return [{ note, options: positions(target, open + source.capo + note.fret, prefer) }];
  });
  let usable = candidates.filter(({ options }) => options.length > 0);
  let fingering = solve(usable.map(({ options }) => options));
  while (!fingering && usable.length > 0) {
    usable = usable.slice(0, -1);
    fingering = solve(usable.map(({ options }) => options));
  }
  const kept = usable.flatMap(({ note }, i) => {
    const position = fingering?.[i];
    return position ? [moved(note, position, target, counts)] : [];
  });
  // Both ends of a tie stay on one string only when the origin kept it; forget strings that moved.
  for (const note of notes) ties.delete(note.string);
  usable.forEach(({ note }, i) => {
    const position = fingering?.[i];
    if (position) ties.set(note.string, position.string);
  });
  counts.dropped += notes.length - kept.length;
  return kept;
}

function refingerBeat(
  beat: Beat,
  source: NeckTrack,
  target: NeckTrack,
  ties: Ties,
  counts: Counts,
): Beat {
  const notes = refingerNotes(beat.notes, source, target, ties, counts);
  // An ornament holds no tie, so each of its notes is refingered on its own.
  const grace = beat.grace?.map((ornament) => ({
    ...ornament,
    notes: refingerNotes(ornament.notes, source, target, new Map(), counts),
  }));
  const emptied = beat.notes.length > 0 && notes.length === 0;
  return { ...beat, notes, ...(emptied && { rest: true }), ...(grace && { grace }) };
}

/**
 * The clip's notes for a fretted track with another string count: the same pitches on the
 * target's strings, frets counting from each track's capo. A beat that loses every note becomes
 * a rest. Same string count keeps string and fret as they are, so the caller does not come here
 * for it.
 */
export function refinger(clip: ClipTrack, target: NeckTrack): Refingered {
  const counts: Counts = { dropped: 0, trillsDropped: 0, harmonicsMoved: 0 };
  const source: NeckTrack = { tuning: clip.tuning, fretCount: clip.fretCount, capo: clip.capo };
  // One tie map per voice, carried across its bars in order.
  const ties = new Map<number, Ties>();
  const bars = clip.bars.map((bar) => ({
    ...bar,
    voices: bar.voices.map((voice) => {
      const carried = ties.get(voice.voice) ?? new Map<number, number>();
      ties.set(voice.voice, carried);
      return {
        ...voice,
        beats: voice.beats.map((beat) => refingerBeat(beat, source, target, carried, counts)),
      };
    }),
  }));
  return {
    ...counts,
    track: {
      ...clip,
      tuning: [...target.tuning],
      fretCount: target.fretCount,
      capo: target.capo,
      bars,
    },
  };
}
