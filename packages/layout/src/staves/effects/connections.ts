import {
  beatTicks,
  type Bar,
  type Beat,
  type Note,
  type TiePosition,
  type Track,
} from '@reprise/model';

/** A voice's beats in one bar of the track; empty past either end. */
export function voiceBeats(track: Track, bar: number, voice: number): readonly Beat[] {
  return track.bars[bar]?.voices[voice]?.beats ?? [];
}

/** Ticks from the bar's start to the beat at `index`. */
export function tickOf(beats: readonly Beat[], index: number): number {
  let tick = 0;
  for (const beat of beats.slice(0, index)) tick += beatTicks(beat);
  return tick;
}

/** The next note on `note`'s string in the voice: later in its bar, else in the next bar. */
export function nextOnString(
  track: Track,
  at: TiePosition,
  note: Note,
): { note: Note; bar: number; beat: number } | undefined {
  for (let bar = at.bar; bar <= at.bar + 1; bar++) {
    const beats = voiceBeats(track, bar, at.voice);
    for (let i = bar === at.bar ? at.beat + 1 : 0; i < beats.length; i++) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const found = beat.notes.find((candidate) => candidate.string === note.string);
      if (found) return { note: found, bar, beat: i };
    }
  }
  return undefined;
}

/** Whether a note starts a shift or legato slide to the next note on its string. */
export function shifts(note: Note): boolean {
  return note.slide?.some((kind) => kind === 'shift' || kind === 'legato') ?? false;
}

const connectionsMemo = new WeakMap<Bar, { shifts: boolean; hammers: boolean }>();

/** Whether a bar holds the origin of a shift or legato slide, or the target of a hammer-on. */
export function connections(bar: Bar | undefined): { shifts: boolean; hammers: boolean } {
  if (!bar) return { shifts: false, hammers: false };
  const known = connectionsMemo.get(bar);
  if (known) return known;
  const found = { shifts: false, hammers: false };
  for (const { beats } of bar.voices) {
    for (const beat of beats) {
      for (const note of beat.notes) {
        if (shifts(note)) found.shifts = true;
        if (note.hammerPull) found.hammers = true;
      }
      // A hammer-on between grace notes is a connection too, so a bar of only those gets its room.
      for (const grace of beat.grace ?? []) {
        if (grace.notes.some((note) => note.hammerPull)) found.hammers = true;
      }
    }
  }
  connectionsMemo.set(bar, found);
  return found;
}

/** `H` for a hammer-on to the same fret or higher, `P` for a pull-off to a lower one. */
export function hammerLetter(origin: Note, target: Note): string {
  return target.fret >= origin.fret ? 'H' : 'P';
}

/** On one string, a higher fret is a higher pitch. */
export function targetIsHigher(origin: Note, target: Note): boolean {
  return target.fret > origin.fret;
}

/** A hammer-on or pull-off from one grace column's note to a later one's on the same string. */
export interface GraceLink {
  from: number;
  to: number;
  origin: Note;
  target: Note;
}

/**
 * The index of the nearest grace column before `before` with a note on `string`, or undefined.
 * A main note's origin is searched the same way, from the column after the last.
 */
export function graceOrigin(
  graces: readonly { notes: readonly Note[] }[],
  before: number,
  string: number,
): { column: number; note: Note } | undefined {
  for (let g = Math.min(before, graces.length) - 1; g >= 0; g--) {
    const note = graces[g]?.notes.find((candidate) => candidate.string === string);
    if (note) return { column: g, note };
  }
  return undefined;
}

/** The links between the grace columns of a beat, one per hammered grace note with an origin. */
export function graceLinks(graces: readonly { notes: readonly Note[] }[] | undefined): GraceLink[] {
  const links: GraceLink[] = [];
  for (const [to, column] of (graces ?? []).entries()) {
    for (const target of column.notes) {
      if (!target.hammerPull) continue;
      const origin = graceOrigin(graces ?? [], to, target.string);
      if (origin) links.push({ from: origin.column, to, origin: origin.note, target });
    }
  }
  return links;
}

/**
 * Of the links between two grace columns going one way, only the outermost carries its letter,
 * as for the hammer-ons of a beat; `depth` grows outwards.
 */
export function lettersOfLinks(
  links: readonly GraceLink[],
  direction: (link: GraceLink) => 'up' | 'down',
  depth: (link: GraceLink) => number,
): Set<Note> {
  const best = new Map<string, GraceLink>();
  for (const link of links) {
    const key = `${String(link.from)}:${String(link.to)}:${direction(link)}`;
    const known = best.get(key);
    if (!known || depth(link) > depth(known)) best.set(key, link);
  }
  return new Set([...best.values()].map(({ target }) => target));
}
