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
      // A grace note hammered from the main note before it is a hammer-on target of this bar.
      if (beat.grace?.some((grace) => grace.notes.some((note) => note.hammerPull))) {
        found.hammers = true;
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
 * The note on `string` in the grace column just before `before`, or undefined. Only that column
 * counts, as for a main note: a link never reaches over a column between, since its slur or
 * letter would be drawn through what that column holds. A main note passes `graces.length`.
 */
export function graceOrigin(
  graces: readonly { notes: readonly Note[] }[],
  before: number,
  string: number,
): { column: number; note: Note } | undefined {
  const column = Math.min(before, graces.length) - 1;
  const note = graces[column]?.notes.find((candidate) => candidate.string === string);
  return note ? { column, note } : undefined;
}

/**
 * Whether the main note of a beat is hammered from the last grace column, which then needs room
 * for its arc: the beat's own notes decide, so a measurement depending on the bar alone holds.
 */
export function mainLinked(beat: {
  grace?: readonly { notes: readonly Note[] }[] | undefined;
  notes: readonly Note[];
}): boolean {
  const graces = beat.grace ?? [];
  return beat.notes.some(
    (note) => note.hammerPull && graceOrigin(graces, graces.length, note.string) !== undefined,
  );
}

/**
 * A grace note in the first column hammered from a note before the beat: the notes of that
 * column with their origin searched by `tieOriginOf`, which the caller supplies, as the origin
 * may lie in the previous bar. Links reach only from the column just before, so later columns
 * never take one.
 */
export function firstGraceHammers(
  grace: readonly { notes: readonly Note[] }[] | undefined,
): Note[] {
  return (grace?.[0]?.notes ?? []).filter((note) => note.hammerPull);
}

/**
 * The next beat on the voice, in this bar or the next, that touches `note`'s string with a main
 * note or a grace note in its first column, when that first touch is a grace note hammered from
 * `note`; its bar. Draws the origin half of a hammer-on whose target is a grace note.
 */
export function graceHammerFrom(
  track: Track,
  at: TiePosition,
  note: Note,
): { bar: number } | undefined {
  for (let bar = at.bar; bar <= at.bar + 1; bar++) {
    const beats = voiceBeats(track, bar, at.voice);
    for (let i = bar === at.bar ? at.beat + 1 : 0; i < beats.length; i++) {
      const beat = beats[i];
      if (!beat || beat.rest) continue;
      const grace = beat.grace?.[0]?.notes.find((candidate) => candidate.string === note.string);
      if (grace) return grace.hammerPull ? { bar } : undefined;
      if (beat.notes.some((candidate) => candidate.string === note.string)) return undefined;
    }
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
