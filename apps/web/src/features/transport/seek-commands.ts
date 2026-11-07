import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import { selectRunning } from '@/state/playback';
import { timelineOf } from '@/state/timeline';

import { extendRange } from './bar-range';
import { describePosition } from './position-format';
import { stepTick, type SeekStep } from './seek';

export type SeekCommandId =
  | 'transport.previousBeat'
  | 'transport.nextBeat'
  | 'transport.previousBar'
  | 'transport.nextBar'
  | 'transport.barStart'
  | 'transport.firstBar'
  | 'transport.lastBar'
  | 'transport.selectPreviousBar'
  | 'transport.selectNextBar';

type SeekCommand = Command & { id: SeekCommandId };

export type SeekServices = Pick<
  AppServices,
  'audio' | 'playback' | 'document' | 'selection' | 'transport' | 'ui' | 'heard'
>;

/** Every seek the app makes: following resumes, then the audio service moves the playhead. */
export function seekTo(services: Pick<SeekServices, 'audio' | 'ui'>, tick: number): void {
  services.ui.getState().requestFollow();
  services.audio.seek(tick);
}

/** The drawn playhead's position while playing, which lags the engine's; else the engine's. */
function drawnPlayhead(services: Pick<SeekServices, 'playback' | 'heard'>) {
  const state = services.playback.getState();
  const drawn = selectRunning(state) ? services.heard.current : undefined;
  const exact = state.position && {
    masterBarId: state.position.masterBarId,
    playbackTick: state.position.position.playbackTick,
  };
  return drawn ?? exact;
}

/** The playhead's playback tick, as drawn; 0 with no position. */
export function playheadTick(services: Pick<SeekServices, 'playback' | 'heard'>): number {
  return drawnPlayhead(services)?.playbackTick ?? 0;
}

/** The playhead's master bar, as drawn. */
export function playheadBar(
  services: Pick<SeekServices, 'playback' | 'heard'>,
): string | undefined {
  return drawnPlayhead(services)?.masterBarId;
}

/** The keyboard's seek and bar-selection commands, on Guitar Pro's keys. */
export function seekCommands(services: SeekServices): SeekCommand[] {
  const { playback, document, selection, transport } = services;

  const step = (kind: SeekStep) => () => {
    const { score } = document.getState();
    if (!score) return;
    const timeline = timelineOf(score);
    const running = selectRunning(playback.getState());
    const { currentTrack } = selection.getState();
    const trackIndex = Math.max(
      0,
      score.tracks.findIndex((track) => track.id === currentTrack),
    );
    const tick = stepTick(timeline, playheadTick(services), kind, { running, trackIndex });
    if (tick === undefined) return;
    seekTo(services, tick);
    // While running the music is the feedback, and a held key would flood the live region.
    if (!running) {
      transport
        .getState()
        .announce(describePosition(timeline, playback.getState().position).sentence);
    }
  };

  const extend = (by: -1 | 1) => () => {
    const { score } = document.getState();
    if (!score) return;
    const { bars, barsAnchor } = selection.getState();
    // The same anchor as Shift+click: a click sets it without selecting.
    const from =
      barsAnchor ?? (bars ? bars.startBar : playheadBar(services)) ?? score.masterBars[0]?.id;
    if (from === undefined) return;
    const range = extendRange(score, bars, from, by);
    if (!range) return;
    selection.getState().selectBars(range, from);
    const number = (id: string) => score.masterBars.findIndex((bar) => bar.id === id) + 1;
    const start = number(range.startBar);
    const end = number(range.endBar);
    transport
      .getState()
      .announce(
        start === end
          ? `Bar ${String(start)} selected`
          : `Bars ${String(start)} to ${String(end)} selected`,
      );
  };

  return [
    {
      id: 'transport.previousBeat',
      title: 'Previous beat',
      shortcut: { key: 'ArrowLeft' },
      run: step('previousBeat'),
    },
    {
      id: 'transport.nextBeat',
      title: 'Next beat',
      shortcut: { key: 'ArrowRight' },
      run: step('nextBeat'),
    },
    {
      id: 'transport.previousBar',
      title: 'Previous bar',
      shortcut: { key: 'ArrowLeft', mod: true },
      run: step('previousBar'),
    },
    {
      id: 'transport.nextBar',
      title: 'Next bar',
      shortcut: { key: 'ArrowRight', mod: true },
      run: step('nextBar'),
    },
    {
      id: 'transport.barStart',
      title: 'Start of bar',
      shortcut: { key: 'Home' },
      repeat: false,
      run: step('barStart'),
    },
    {
      id: 'transport.firstBar',
      title: 'First bar',
      shortcut: { key: 'Home', mod: true },
      repeat: false,
      run: step('firstBar'),
    },
    {
      id: 'transport.lastBar',
      title: 'Last bar',
      shortcut: { key: 'End', mod: true },
      repeat: false,
      run: step('lastBar'),
    },
    {
      id: 'transport.selectPreviousBar',
      title: 'Extend selection to previous bar',
      shortcut: { key: 'ArrowLeft', mod: true, shift: true },
      run: extend(-1),
    },
    {
      id: 'transport.selectNextBar',
      title: 'Extend selection to next bar',
      shortcut: { key: 'ArrowRight', mod: true, shift: true },
      run: extend(1),
    },
  ];
}
