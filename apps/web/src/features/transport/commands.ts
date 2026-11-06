import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import { selectCanPlay } from '@/state/playback';
import { timelineOf, writtenBpmAt } from '@/state/timeline';

import { applyLoop, wholeSong } from './loop';
import { describePosition } from './position-format';
import { percentOf, stepPercent, TEMPO_PERCENT } from './tempo';

export type TransportCommandId =
  | 'transport.playPause'
  | 'transport.stop'
  | 'transport.playFromStart'
  | 'transport.toggleLoop'
  | 'transport.toggleCountIn'
  | 'transport.toggleMetronome'
  | 'transport.metronomeVolume'
  | 'transport.masterVolume'
  | 'transport.setTempo'
  | 'transport.slowDown'
  | 'transport.speedUp'
  | 'transport.toggleSpeed'
  | 'transport.announcePosition';

type TransportCommand = Command & { id: TransportCommandId };

export type TransportServices = Pick<
  AppServices,
  'audio' | 'playback' | 'document' | 'selection' | 'transport'
>;

/** The current speed in percent, read from the store, never cached. */
export function currentPercent(services: Pick<TransportServices, 'playback' | 'document'>): number {
  const { score } = services.document.getState();
  const { settings, position } = services.playback.getState();
  const written = score ? writtenBpmAt(timelineOf(score), position) : 120;
  return percentOf(settings.tempo, written);
}

export function transportCommands(services: TransportServices): TransportCommand[] {
  const { audio, playback, document, selection, transport } = services;
  const hasScore = () => document.getState().score !== undefined;
  const setPercent = (percent: number) => {
    audio.setTempo('percent', percent);
  };
  const stepBy = (direction: -1 | 1) => {
    if (hasScore()) setPercent(stepPercent(currentPercent(services), direction));
  };

  return [
    {
      id: 'transport.playPause',
      title: 'Play or pause',
      shortcut: { key: ' ' },
      repeat: false,
      run: () => {
        audio.togglePlay();
      },
    },
    {
      id: 'transport.stop',
      title: 'Stop',
      shortcut: { key: 'Enter' },
      repeat: false,
      run: () => {
        audio.stop();
      },
    },
    {
      id: 'transport.playFromStart',
      title: 'Play from start',
      shortcut: { key: ' ', shift: true },
      repeat: false,
      run: () => {
        if (!selectCanPlay(playback.getState())) return;
        audio.stop();
        audio.play();
      },
    },
    {
      id: 'transport.toggleLoop',
      title: 'Toggle loop',
      shortcut: { key: 'F9' },
      repeat: false,
      run: () => {
        const { score } = document.getState();
        if (!score) return;
        if (playback.getState().settings.loop) {
          audio.setLoop(undefined);
          return;
        }
        const failed = applyLoop(services, score, selection.getState().bars ?? wholeSong(score));
        if (failed) transport.getState().announce(failed);
      },
    },
    {
      id: 'transport.toggleCountIn',
      title: 'Toggle count-in',
      shortcut: { key: 'c', alt: true },
      repeat: false,
      run: () => {
        audio.setCountIn(!playback.getState().settings.countIn);
      },
    },
    {
      id: 'transport.toggleMetronome',
      title: 'Toggle metronome',
      shortcut: { key: 'm', alt: true },
      repeat: false,
      run: () => {
        const { on, volume } = playback.getState().settings.metronome;
        audio.setMetronome(!on, volume);
      },
    },
    {
      id: 'transport.metronomeVolume',
      title: 'Metronome volume…',
      shortcut: { key: 'm', alt: true, shift: true },
      repeat: false,
      run: () => {
        transport.getState().setPopover('metronome');
      },
    },
    {
      id: 'transport.masterVolume',
      title: 'Master volume…',
      shortcut: { key: 'v', alt: true, shift: true },
      repeat: false,
      run: () => {
        transport.getState().setPopover('master');
      },
    },
    {
      id: 'transport.setTempo',
      title: 'Set tempo…',
      shortcut: { key: 't', alt: true },
      repeat: false,
      run: () => {
        if (hasScore()) transport.getState().requestFocus('tempo');
      },
    },
    {
      id: 'transport.slowDown',
      title: 'Slow down 5%',
      shortcut: { key: '[' },
      run: () => {
        stepBy(-1);
      },
    },
    {
      id: 'transport.speedUp',
      title: 'Speed up 5%',
      shortcut: { key: ']' },
      run: () => {
        stepBy(1);
      },
    },
    {
      id: 'transport.toggleSpeed',
      title: 'Toggle relative speed',
      shortcut: { key: 'F9', mod: true },
      repeat: false,
      run: () => {
        if (!hasScore()) return;
        const percent = currentPercent(services);
        const ui = transport.getState();
        if (percent !== TEMPO_PERCENT.default) {
          ui.setRememberedSpeed(percent);
          setPercent(TEMPO_PERCENT.default);
        } else if (ui.rememberedSpeed !== undefined) {
          setPercent(ui.rememberedSpeed);
        }
      },
    },
    {
      id: 'transport.announcePosition',
      title: 'Announce position',
      shortcut: { key: 'p', alt: true },
      repeat: false,
      run: () => {
        const { score } = document.getState();
        const timeline = score && timelineOf(score);
        transport
          .getState()
          .announce(describePosition(timeline, playback.getState().position).sentence);
      },
    },
  ];
}
