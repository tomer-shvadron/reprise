import type { AudioService } from '@/app/audio/audio-service';
import type { DocumentStore } from '@/state/document';
import type { PlaybackStore, TempoSetting } from '@/state/playback';
import type { SelectionStore } from '@/state/selection';

import { applyLoop } from './loop';
import { readTransportPreferences, writeTransportPreferences } from './preferences';
import { TEMPO_PERCENT } from './tempo';
import type { TransportUiStore } from './transport-ui';

export interface TransportDeps {
  audio: AudioService;
  playback: PlaybackStore;
  document: DocumentStore;
  selection: SelectionStore;
  transport: TransportUiStore;
  storage?: () => Storage;
}

/**
 * Wires the transport's rules that no control owns: the stored preferences in and out, the speed
 * per song, and the loop following the selection and the score's edits. Returns its cleanup.
 */
export function installTransport(deps: TransportDeps): () => void {
  const { audio, playback, document, selection, transport, storage } = deps;

  const stored = readTransportPreferences(storage);
  audio.setCountIn(stored.countIn);
  audio.setMetronome(stored.metronome.on, stored.metronome.volume);
  audio.setMasterVolume(stored.masterVolume);

  const unsubscribePlayback = playback.subscribe(({ settings }, { settings: before }) => {
    if (
      settings.countIn === before.countIn &&
      settings.metronome === before.metronome &&
      settings.masterVolume === before.masterVolume
    ) {
      return;
    }
    const { countIn, metronome, masterVolume } = settings;
    writeTransportPreferences({ countIn, metronome, masterVolume }, storage);
  });

  // The speed is a song's own: a different song starts at 100%, the same file reopened keeps it.
  const speeds = new Map<string, TempoSetting>();
  const unsubscribeDocument = document.subscribe((state, previous) => {
    if (state.id !== previous.id) {
      if (previous.file) speeds.set(previous.file.name, playback.getState().settings.tempo);
      const kept = state.file && speeds.get(state.file.name);
      const tempo = kept ?? { mode: 'percent', value: TEMPO_PERCENT.default };
      audio.setTempo(tempo.mode, tempo.value);
      transport.getState().setRememberedSpeed(undefined);
      return;
    }
    const { loop } = playback.getState().settings;
    if (state.score === previous.score || !loop || !state.score) return;
    const ids = new Set(state.score.masterBars.map((bar) => bar.id));
    if (!ids.has(loop.startBar) || !ids.has(loop.endBar)) audio.setLoop(undefined);
  });

  // A cleared selection keeps the loop, so a click that seeks cannot widen it to the whole song.
  const unsubscribeSelection = selection.subscribe(({ bars }, { bars: before }) => {
    if (!bars || bars === before || !playback.getState().settings.loop) return;
    const failed = applyLoop({ audio, playback }, document.getState().score, bars);
    if (failed) transport.getState().announce(failed);
  });

  return () => {
    unsubscribePlayback();
    unsubscribeDocument();
    unsubscribeSelection();
  };
}
