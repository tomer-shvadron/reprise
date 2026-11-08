import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

/**
 * 4/4 at 120: bar 0 holds six quarters, ramping to 100 into its first overflow beat and stepping
 * to 60 on its last; bars 1 and 2 hold four. No program change, since alphaTab moves every
 * `Sound` automation onto its bar's first beat.
 */
export function overfullBarScore(): Score {
  return score()
    .tempo(120)
    .track('guitar')
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 1)])
    .beat('4', [note(1, 2)], { mix: { tempo: { bpm: 100, duration: 2 } } })
    .beat('4', [note(1, 3)])
    .beat('4', [note(1, 4)])
    .beat('4', [note(1, 5)], { mix: { tempo: { bpm: 60 } } })
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 1)])
    .beat('4', [note(1, 2)])
    .beat('4', [note(1, 3)])
    .bar()
    .beat('4', [note(1, 0)])
    .beat('4', [note(1, 1)])
    .beat('4', [note(1, 2)])
    .beat('4', [note(1, 3)])
    .build({ validate: false });
}
