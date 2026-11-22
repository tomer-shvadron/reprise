import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import { selectCanPlay, selectRunning } from '@/state/playback';
import { timelineOf, writtenBpmAt } from '@/state/timeline';

import { applyLoop, wholeSong } from './loop';
import { sectionRange, targetBars, targetPlace } from './menu-target';
import { describePosition } from './position-format';
import { playheadBar } from './seek-commands';
import { seekToBar } from './seek-target';
import {
  clampBpm,
  clampPercent,
  FIXED_BPM,
  isFixed,
  percentOf,
  stepPercent,
  TEMPO_PERCENT,
} from './tempo';

export type TransportCommandId =
  | 'transport.playPause'
  | 'transport.stop'
  | 'transport.playFromStart'
  | 'transport.toggleLoop'
  | 'transport.playFromSelection'
  | 'transport.loopSelection'
  | 'transport.loopSection'
  | 'transport.toggleCountIn'
  | 'transport.toggleMetronome'
  | 'transport.metronomeVolume'
  | 'transport.masterVolume'
  | 'transport.setTempo'
  | 'transport.slowDown'
  | 'transport.speedUp'
  | 'transport.toggleSpeed'
  | 'transport.toggleFixedTempo'
  | 'transport.announcePosition';

type TransportCommand = Command & { id: TransportCommandId };

export type TransportServices = Pick<
  AppServices,
  'audio' | 'playback' | 'document' | 'selection' | 'transport' | 'heard' | 'menuTarget' | 'ui'
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
    if (!hasScore()) return;
    const { tempo } = playback.getState().settings;
    // Fixed tempo steps the BPM itself; otherwise the speed steps on the 5% grid.
    if (isFixed(tempo)) audio.setTempo('bpm', clampBpm(tempo.value + direction * FIXED_BPM.step));
    else setPercent(stepPercent(currentPercent(services), direction));
  };

  /** The section of the right-clicked marker, else the one holding the first selected bar. */
  const sectionTarget = () => {
    const { score } = document.getState();
    const target = services.menuTarget.getState().target;
    const bar = target?.kind === 'section' ? target.masterBar : targetBars(services)?.startBar;
    return score && bar !== undefined ? sectionRange(score, bar) : undefined;
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
        // A plain click records only `barsAnchor`; looping that bar beats the whole song, and not
        // selecting on click keeps a seek-click inside a loop from narrowing it. The anchor
        // outlives the click, so it counts only while the bar exists and the playhead is in it.
        const { bars, barsAnchor } = selection.getState();
        const clicked =
          barsAnchor !== undefined &&
          score.masterBars.some((bar) => bar.id === barsAnchor) &&
          playheadBar(services) === barsAnchor
            ? { startBar: barsAnchor, endBar: barsAnchor }
            : undefined;
        const failed = applyLoop(services, score, bars ?? clicked ?? wholeSong(score));
        if (failed) transport.getState().announce(failed);
      },
    },
    {
      id: 'transport.playFromSelection',
      title: 'Play from selection',
      // No key: it is the menu's "Play from here". A plain click already seeks, and Space plays.
      repeat: false,
      enabled: hasScore,
      run: () => {
        const { score } = document.getState();
        const place = targetPlace(services);
        if (!score || !place) {
          if (score) transport.getState().announce('Select a bar to play from');
          return;
        }
        // A seek outside an active loop turns the loop off, as a click does; a refused one says why.
        if (!seekToBar(services, score, place)) return;
        if (!selectRunning(playback.getState())) audio.play();
      },
    },
    {
      id: 'transport.loopSelection',
      title: 'Loop selection',
      repeat: false,
      enabled: () => targetBars(services) !== undefined,
      run: () => {
        const { score } = document.getState();
        const bars = targetBars(services);
        if (!score || !bars) return;
        // Replaces any loop: where `toggleLoop` would turn an active one off.
        const failed = applyLoop(services, score, bars);
        if (failed) transport.getState().announce(failed);
      },
    },
    {
      id: 'transport.loopSection',
      title: 'Loop this section',
      repeat: false,
      inPalette: false,
      enabled: () => sectionTarget() !== undefined,
      run: () => {
        const { score } = document.getState();
        const bars = sectionTarget();
        if (!score || !bars) return;
        const failed = applyLoop(services, score, bars);
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
        const ui = transport.getState();
        if (isFixed(playback.getState().settings.tempo)) {
          ui.announce('Fixed tempo is on');
          return;
        }
        const percent = currentPercent(services);
        if (percent !== TEMPO_PERCENT.default) {
          ui.setRememberedSpeed(percent);
          setPercent(TEMPO_PERCENT.default);
        } else if (ui.rememberedSpeed !== undefined) {
          setPercent(ui.rememberedSpeed);
        }
      },
    },
    {
      id: 'transport.toggleFixedTempo',
      title: 'Fixed tempo',
      repeat: false,
      run: () => {
        const { score } = document.getState();
        if (!score) return;
        const ui = transport.getState();
        const { tempo } = playback.getState().settings;
        if (isFixed(tempo)) {
          setPercent(clampPercent(ui.fixedReturn ?? TEMPO_PERCENT.default));
          ui.setFixedReturn(undefined);
          ui.announce('Fixed tempo off');
          return;
        }
        const written = writtenBpmAt(timelineOf(score), playback.getState().position);
        ui.setFixedReturn(currentPercent(services));
        audio.setTempo('bpm', clampBpm(Math.round((written * currentPercent(services)) / 100)));
        ui.announce('Fixed tempo on');
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
