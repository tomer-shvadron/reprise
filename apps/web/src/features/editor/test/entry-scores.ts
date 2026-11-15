import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

/** One guitar track over one 4/4 bar of four quarters: a full last bar. */
export function fullBarScore(): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(2, 1)])
    .beat('4', [note(3, 2)])
    .beat('4', [note(4, 3)]);
  return built.build({ ids: 'sequential' });
}

/**
 * One guitar track: an empty bar, a bar of three quarters and an eighth (an eighth left), and a
 * bar of four quarters, the first on string 1 fret 5, which a tie can continue.
 */
export function entryScore(): Score {
  const built = score().track('guitar');
  built.bar();
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 3)])
    .beat('4', [note(3, 3)])
    .beat('8', [note(1, 9)]);
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(1, 7)])
    .beat('4', [note(3, 2)])
    .beat('4', [note(4, 3)]);
  return built.build({ ids: 'sequential' });
}
