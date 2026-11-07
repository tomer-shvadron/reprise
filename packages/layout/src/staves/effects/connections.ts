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
