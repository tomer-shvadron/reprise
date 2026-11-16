import { DYNAMICS_VELOCITY } from '@reprise/audio';
import { beatTicks, DEFAULT_BPM, PPQ, type Id, type Score } from '@reprise/model';

import { scoreIndex } from '@/features/score';

export interface PreviewSound {
  track: Id;
  beat: Id;
  string: number;
  fret: number;
}

/**
 * How an entered note sounds: its dynamic as the velocity and its beat's written length, at the
 * tempo in force at its bar, as the sounding time. Read from the score after the edit, so a beat
 * that was lengthened or a note given a dynamic earlier is heard as it will play. Undefined
 * options leave the sampler's preview defaults.
 */
export function previewOptions(
  score: Score,
  sound: PreviewSound,
): { velocity?: number; seconds?: number } {
  const info = scoreIndex(score).beats.get(sound.beat);
  const track = score.tracks[info?.trackIndex ?? -1];
  const beat =
    track?.bars[info?.masterBarIndex ?? -1]?.voices[info?.voice ?? -1]?.beats[info?.index ?? -1];
  if (!info || !beat) return {};
  const note = beat.notes.find(({ string }) => string === sound.string);
  let bpm = DEFAULT_BPM;
  for (let bar = 0; bar <= info.masterBarIndex; bar += 1) {
    bpm = score.masterBars[bar]?.tempo?.bpm ?? bpm;
  }
  return {
    ...(note && { velocity: DYNAMICS_VELOCITY[note.dynamics] }),
    seconds: (beatTicks(beat) / PPQ) * (60 / bpm),
  };
}
