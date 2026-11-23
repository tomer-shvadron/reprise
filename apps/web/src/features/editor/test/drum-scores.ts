import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

/** One drums track: an empty bar, then a bar of a kick and a snare with a hi-hat on the snare's beat. */
export function drumScore(): Score {
  const built = score().track('drums');
  built.bar();
  built
    .bar()
    .beat('4', [note(0, 36)])
    .beat('4', [note(0, 38), note(0, 42)]);
  return built.build({ ids: 'sequential' });
}
