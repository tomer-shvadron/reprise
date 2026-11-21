import type { Id } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { scoreIndex } from '@/features/score';

/** The name of the chord on a beat, or undefined when the beat has none or is gone. */
export function chordNameOfBeat(
  services: Pick<AppServices, 'document'>,
  beat: Id | undefined,
): string | undefined {
  const { score } = services.document.getState();
  if (!score || beat === undefined) return undefined;
  const info = scoreIndex(score).beats.get(beat);
  const found =
    info &&
    score.tracks[info.trackIndex]?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index];
  const name = found?.chord?.name;
  return name === undefined || name === '' ? undefined : name;
}
