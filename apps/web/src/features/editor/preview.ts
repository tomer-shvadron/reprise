import { DYNAMICS_VELOCITY } from '@reprise/audio';
import { beatTicks, secondsAt, tempoMap, type Id, type Score } from '@reprise/model';

import { scoreIndex } from '@/features/score';

export interface PreviewSound {
  track: Id;
  beat: Id;
  string: number;
  fret: number;
}

/**
 * How an entered note sounds: its dynamic as the velocity and its beat's written length, timed
 * by the model's tempo map (bar marks, beat-level changes and ramps), as the sounding time. A
 * tied note previews its own beat's length, not the whole tie. Read from the score after the
 * edit, so a beat that was lengthened is heard as it will play. The map covers the bars up to
 * the beat's, once, so a keystroke costs a pass over those bars. An unknown beat gives no
 * options, which leaves the sampler's preview defaults; the audio service clamps the seconds.
 */
export function previewOptions(
  score: Score,
  sound: PreviewSound,
): { velocity?: number; seconds?: number } {
  const info = scoreIndex(score).beats.get(sound.beat);
  if (!info) return {};
  const beat =
    score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  if (!beat) return {};
  // By slot, not string: a drum beat holds several string-0 notes, one per key.
  const fretted = score.tracks[info.trackIndex]?.kind === 'fretted';
  const note = beat.notes.find(({ string, fret }) =>
    fretted ? string === sound.string : fret === sound.fret,
  );
  const sequence = Array.from({ length: info.masterBarIndex + 1 }, (_, masterBarIndex) => ({
    masterBarIndex,
    passIndex: 0,
  }));
  const map = tempoMap(score, sequence);
  const last = sequence.length - 1;
  return {
    ...(note && { velocity: DYNAMICS_VELOCITY[note.dynamics] }),
    seconds: secondsAt(map, last, info.tick + beatTicks(beat)) - secondsAt(map, last, info.tick),
  };
}
