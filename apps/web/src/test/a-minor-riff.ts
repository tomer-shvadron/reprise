import { note, score } from '@reprise/model/testing';

/** A riff of A minor pentatonic notes on the high E string, ending on A, with an A in the bass. */
export function aMinorRiff() {
  const builder = score().tempo(120).track('guitar');
  for (let round = 0; round < 6; round++) {
    builder.bar();
    [5, 8, 10, 8, 5, 3, 5, 0].forEach((fret, at) => {
      builder.beat('8', at === 0 ? [note(1, fret), note(5, 0)] : [note(1, fret)]);
    });
  }
  return builder.build();
}
