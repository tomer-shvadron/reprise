import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

/**
 * One keyboard track in G major: an empty bar, a bar of a G4 quarter and an E5 quarter with a C5
 * chord note on it (leaving half a bar), then an empty bar in C major.
 */
export function keysScore(): Score {
  const built = score().key(1).track('piano');
  built.bar();
  built
    .bar()
    .beat('4', [note(0, 67)])
    .beat('4', [note(0, 76), note(0, 72)]);
  built.bar();
  return built.build({ ids: 'sequential' });
}
