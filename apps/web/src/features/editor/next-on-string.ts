import type { Note, TiePosition, Track } from '@reprise/model';

export interface StringLink {
  note: Note;
  bar: number;
  beat: number;
}

/**
 * The next note on `string` after the beat at `at`, in the same voice, looking up to `reach`
 * bars past the bar `at` is in. Rests and beats with no note on that string are passed over, as
 * layout does when it draws a slide or a hammer-on, so a connection the editor sets is one the
 * painter draws. Pure and read-only.
 */
export function nextOnString(
  track: Pick<Track, 'bars'>,
  at: TiePosition,
  string: number,
  reach: number,
): StringLink | undefined {
  for (let bar = at.bar; bar <= at.bar + reach && bar < track.bars.length; bar++) {
    const beats = track.bars[bar]?.voices[at.voice]?.beats ?? [];
    for (let index = bar === at.bar ? at.beat + 1 : 0; index < beats.length; index++) {
      const beat = beats[index];
      if (!beat || beat.rest) continue;
      const note = beat.notes.find((candidate) => candidate.string === string);
      if (note) return { note, bar, beat: index };
    }
  }
  return undefined;
}
