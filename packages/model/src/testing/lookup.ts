import type { Beat, Note, Score } from '../index';

/** The beat at track, bar, beat and voice indices; throws when there is none. */
export function beatOf(score: Score, track: number, bar: number, beat: number, voice = 0): Beat {
  const found = score.tracks[track]?.bars[bar]?.voices[voice]?.beats[beat];
  if (!found) {
    throw new Error(`no beat at ${String(track)}/${String(bar)}/${String(voice)}/${String(beat)}`);
  }
  return found;
}

/** The note at index `note` of `beatOf(score, track, bar, beat)` in voice 0. */
export function noteOf(score: Score, track: number, bar: number, beat: number, note = 0): Note {
  const found = beatOf(score, track, bar, beat).notes[note];
  if (!found) throw new Error(`no note ${String(note)} on that beat`);
  return found;
}
