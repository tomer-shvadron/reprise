import type { Score } from '@reprise/model';

import { chord, song, type SongBar } from '@/lib/insights/test/songs';

const A = 9;

const strip = (bars: SongBar[]): SongBar[] =>
  bars.map((bar) =>
    bar.name === undefined ? { chord: bar.chord } : { chord: bar.chord, name: bar.name },
  );

/** Verse and "Solo chorus", each four bars twice over, with chord names written: one key, A minor. */
export function twoSections(): Score {
  const verse: SongBar[] = [
    { chord: chord(A, true), name: 'Am', section: 'Verse' },
    { chord: chord(5), name: 'F' },
    { chord: chord(0), name: 'C' },
    { chord: chord(7), name: 'G' },
  ];
  const chorus: SongBar[] = [
    { chord: chord(0), name: 'C', section: 'Solo chorus' },
    { chord: chord(7), name: 'G' },
    { chord: chord(A, true), name: 'Am' },
    { chord: chord(5), name: 'F' },
  ];
  return song([...verse, ...strip(verse), ...chorus, ...strip(chorus)]);
}

/**
 * A verse in A minor and a bridge in D minor, each with a pentatonic melody on its own track: the
 * bridge has a key, a scale and a melody scale of its own.
 */
export function modulating(): Score {
  const D = 2;
  const aMinorPentatonic = [69, 72, 74, 76, 79, 81, 84, 88];
  const dMinorPentatonic = aMinorPentatonic.map((pitch) => pitch + 5);
  const verse: SongBar[] = [
    { chord: chord(A, true), name: 'Am', section: 'Verse' },
    { chord: chord(5), name: 'F' },
    { chord: chord(0), name: 'C' },
    { chord: chord(7), name: 'G' },
  ].map((bar) => ({ ...bar, melody: aMinorPentatonic }));
  const bridge: SongBar[] = [
    { chord: chord(D, true), name: 'Dm', section: 'Bridge' },
    { chord: chord(10), name: 'Bb' },
    { chord: chord(5), name: 'F' },
    { chord: chord(0), name: 'C' },
  ].map((bar) => ({ ...bar, melody: dMinorPentatonic }));
  const again = (bars: SongBar[]): SongBar[] =>
    bars.map((bar) => ({
      chord: bar.chord,
      ...(bar.name ? { name: bar.name } : {}),
      ...(bar.melody ? { melody: bar.melody } : {}),
    }));
  return song([...verse, ...again(verse), ...bridge, ...again(bridge)]);
}
