import { loopRange } from '@reprise/audio';
import type { Id } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { loopBarNumbers } from '@/features/transport';
import type { BarRange } from '@/state/selection';
import { timelineOf } from '@/state/timeline';

import type { ResumeTarget } from './summary';

export type ResumeServices = Pick<
  AppServices,
  'document' | 'audio' | 'playback' | 'transport' | 'ui'
>;

/**
 * Brings back where the song was left: opens it unless it is open, then the target's loop (by bar
 * id, so it follows bars inserted since) and tempo, and shows the player. A loop whose bars are
 * gone restores the tempo only and says so.
 */
export async function resumePractice(
  services: ResumeServices,
  songId: Id,
  target: ResumeTarget,
  open: () => Promise<void>,
): Promise<void> {
  const { document, audio, playback, transport, ui } = services;
  const announce = (text: string) => {
    transport.getState().announce(text);
  };
  const isOpen = () => {
    const state = document.getState();
    return state.songId === songId && state.score !== undefined;
  };
  if (!isOpen()) await open();
  // A cancelled save prompt or a failed open leaves another document up.
  if (!isOpen()) return;
  const score = document.getState().score;
  if (!score) return;

  const notes: string[] = [];
  let seekTo: number | undefined;
  const { loop } = target;
  if (loop) {
    const range: BarRange = { startBar: loop.startBar, endBar: loop.endBar };
    const bars = loopBarNumbers(score, range);
    if (!bars) {
      notes.push('Its loop’s bars are gone, so only the tempo is restored.');
    } else {
      const previous = playback.getState().settings.loop;
      try {
        audio.setLoop(range);
        seekTo = loopRange(timelineOf(score), range, 0).startTick;
        notes.push(`Looping bars ${String(bars.start)} to ${String(bars.end)}.`);
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        // The engine stores the bars before it checks them, so bring the previous loop back.
        audio.setLoop(previous);
        notes.push('Its loop can’t be played in that order, so only the tempo is restored.');
      }
    }
  }
  // After the open: its per-song speed restore has already run, so Resume wins.
  if (target.tempo) audio.setTempo(target.tempo.mode, target.tempo.value);
  // `seek` does nothing before the song has loaded, which is the case right after `open()`; Play
  // then starts at the loop's start, since the engine moves a start outside the loop to it. The
  // same load is why a loop the engine cannot play is only dropped there, not rejected above.
  if (seekTo !== undefined && playback.getState().song.status === 'ready') audio.seek(seekTo);
  ui.getState().setScreen('player');
  announce(['Resumed practice.', ...notes].join(' '));
}
