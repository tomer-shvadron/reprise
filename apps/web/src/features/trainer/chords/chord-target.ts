import type { Id, Score, Track } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { scoreIndex } from '@/lib/score-index';

function nameOf(
  track: Track | undefined,
  info: { masterBarIndex: number; voice: number; index: number },
) {
  const name = track?.bars[info.masterBarIndex]?.voices[info.voice]?.beats[info.index]?.chord?.name;
  return name === undefined || name === '' ? undefined : name;
}

/** The name of the chord on a beat, or undefined when the beat has none or is gone. */
export function chordNameOfBeat(
  services: Pick<AppServices, 'document'>,
  beat: Id | undefined,
): string | undefined {
  const { score } = services.document.getState();
  if (!score || beat === undefined) return undefined;
  const info = scoreIndex(score).beats.get(beat);
  return info && nameOf(score.tracks[info.trackIndex], info);
}

/** The last chord of the track at or before the drawn playhead; undefined before the first one. */
export function chordNameAtPlayhead(
  score: Score,
  track: Track,
  at: { masterBarId: Id; tick: number } | undefined,
): string | undefined {
  if (!at) return undefined;
  const index = scoreIndex(score);
  const bar = index.barIndex.get(at.masterBarId);
  if (bar === undefined) return undefined;
  let found: { name: string; bar: number; tick: number } | undefined;
  track.bars.forEach((trackBar, barIndex) => {
    if (barIndex > bar) return;
    for (const voice of trackBar.voices) {
      for (const beat of voice.beats) {
        const name = beat.chord?.name;
        const info = index.beats.get(beat.id);
        if (!name || !info) continue;
        if (barIndex === bar && info.tick > at.tick) continue;
        if (!found || barIndex > found.bar || (barIndex === found.bar && info.tick >= found.tick)) {
          found = { name, bar: barIndex, tick: info.tick };
        }
      }
    }
  });
  return found?.name;
}
