import type { Score } from '@reprise/model';
import { midi, score as buildScore } from '@reprise/model/testing';

/** One bar of a built song. */
export interface SongBar {
  /** Sounding pitches, bass first; struck on every beat unless the song is arpeggiated. */
  chord: readonly number[];
  /** The name written above the bar's first beat; absent for none. */
  name?: string;
  /** Eight eighth notes of a melody on its own track; absent for none. */
  melody?: readonly number[];
  /** A section starts on this bar. */
  section?: string;
}

export interface SongOptions {
  /** Play the chord one note at a time, in eighths, so no beat sounds three pitch classes. */
  arpeggiate?: boolean;
  /** Name of the chord track. */
  chordTrack?: string;
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** A bass note in octave 2, then the triad in octave 4: a major or minor chord on a pitch class. */
export const chord = (pc: number, minor = false): number[] => [
  36 + pc,
  60 + pc,
  60 + pc + (minor ? 3 : 4),
  60 + pc + 7,
];

/** Eight eighths of the major scale from the tonic up: key evidence for a melody track. */
export const run = (tonic: number): number[] => [
  ...MAJOR.map((step) => 72 + tonic + step),
  84 + tonic,
];

/** Bars of `chords` repeated `times` times. */
export const repeat = (bars: readonly SongBar[], times: number): SongBar[] =>
  Array.from({ length: times }, () => bars).flat();

export function song(bars: readonly SongBar[], options: SongOptions = {}): Score {
  const builder = buildScore().track('piano', { name: options.chordTrack ?? 'Chords' });
  for (const bar of bars) {
    builder.bar();
    if (bar.section) builder.section(bar.section);
    if (options.arpeggiate) {
      for (let slot = 0; slot < 8; slot++) {
        builder.beat(
          '8',
          [midi(bar.chord[slot % bar.chord.length] ?? 60)],
          slot === 0 && bar.name ? { chord: { name: bar.name } } : {},
        );
      }
      continue;
    }
    for (let beat = 0; beat < 4; beat++) {
      builder.beat(
        '4',
        bar.chord.map((pitch) => midi(pitch)),
        beat === 0 && bar.name ? { chord: { name: bar.name } } : {},
      );
    }
  }
  if (bars.some((bar) => bar.melody)) {
    builder.track('piano', { name: 'Melody' });
    for (const bar of bars) {
      builder.bar();
      for (let slot = 0; slot < 8; slot++) {
        const pitch = bar.melody?.[slot];
        if (pitch === undefined) builder.rest('8');
        else builder.beat('8', [midi(pitch)]);
      }
    }
  }
  return builder.build();
}
