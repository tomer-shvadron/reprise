import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

/**
 * One guitar track, three 4/4 bars. Bar 1: two quarters, a quarter rest, an empty beat. Bar 2:
 * four quarters, the first with the chord `Am` and a diagram. Bar 3: four quarters.
 */
export function wordScore(): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(2, 1)])
    .rest('4')
    .beat('4');
  built
    .bar()
    .beat('4', [note(1, 2)], {
      chord: { name: 'Am', diagram: { baseFret: 1, frets: [0, 1, 2, 2, 0, null] } },
    })
    .beat('4', [note(2, 3)])
    .beat('4', [note(3, 2)])
    .beat('4', [note(4, 3)]);
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 5)])
    .beat('4', [note(3, 5)])
    .beat('4', [note(4, 5)]);
  return built.build({ ids: 'sequential' });
}
