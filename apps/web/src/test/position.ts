import type { PositionEvent } from '@reprise/audio';
import { positionAtSeconds, secondsAtTick, type Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';

import { timelineOf } from '@/state/timeline';

/** The engine's position event at `playbackTick`, built from the model's own timing. */
export function positionEventAt(
  song: Score,
  playbackTick: number,
  countingIn = false,
): PositionEvent {
  const { map } = timelineOf(song);
  const seconds = secondsAtTick(map, playbackTick);
  const position = positionAtSeconds(map, seconds);
  const masterBar = position && song.masterBars[position.masterBarIndex];
  if (!position || !masterBar) throw new Error(`no position at tick ${String(playbackTick)}`);
  return { position, masterBarId: masterBar.id, seconds, countingIn };
}

/** Four bars of quarter notes in 4/4 at 120, with a tempo mark of 160 on bar 3. */
export function fourBars(): Score {
  const builder = score().title('Four bars').tempo(120).track('guitar');
  for (let bar = 0; bar < 4; bar++) {
    builder.bar();
    if (bar === 2) builder.tempo(160);
    for (let beat = 0; beat < 4; beat++) builder.beat('4', [note(1, bar)]);
  }
  return builder.build();
}
