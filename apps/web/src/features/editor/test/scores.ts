import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

/**
 * Two tracks over three 4/4 bars. Guitar: a full bar of quarters; two quarters in voice 0 and a
 * half in voice 1; an empty bar. Drums: the same rhythm, so a cursor can change track at an onset.
 */
export function editScore(): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(2, 1)])
    .beat('4', [note(3, 2)])
    .beat('4', [note(6, 3)]);
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(4, 7), note(2, 3)])
    .voice(1)
    .beat('2', [note(5, 2)]);
  built.bar();
  built.track('drums');
  built
    .bar()
    .beat('4', [note(0, 0)])
    .beat('4', [note(0, 0)])
    .beat('4', [note(0, 0)])
    .beat('4', [note(0, 0)]);
  built
    .bar()
    .beat('4', [note(0, 0)])
    .beat('4', [note(0, 0)]);
  built.bar();
  return built.build({ ids: 'sequential' });
}
