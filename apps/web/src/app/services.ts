import { viewLayoutOptions } from '@/features/score';
// Not the feature's index: it re-exports the bar, whose services context imports this file.
import { installTransport } from '@/features/transport/install-transport';
import { createTransportUi, type TransportUiStore } from '@/features/transport/transport-ui';
import type { Platform } from '@/platform/platform';
import { createDocumentStore, type DocumentStore, type DocumentStoreDeps } from '@/state/document';
import { createLayoutStore, type LayoutStore } from '@/state/layout';
import { createPlaybackStore, type PlaybackStore } from '@/state/playback';
import { createSelectionStore, type SelectionStore } from '@/state/selection';
import { createUiStore, type UiStore } from '@/state/ui';

import { createAudioService, type AudioService } from './audio/audio-service';

export interface AppServices {
  platform: Platform;
  ui: UiStore;
  document: DocumentStore;
  selection: SelectionStore;
  playback: PlaybackStore;
  layout: LayoutStore;
  audio: AudioService;
  /** The transport bar's UI state, reachable from its commands. */
  transport: TransportUiStore;
  dispose(): void;
}

export interface AppServicesOptions {
  platform: Platform;
  ui?: UiStore;
  audio?: (playback: PlaybackStore) => AudioService;
  read?: DocumentStoreDeps['read'];
  write?: DocumentStoreDeps['write'];
  /** Where the transport keeps its preferences; `localStorage` by default. */
  storage?: () => Storage;
}

/** Every store and the audio service, created once outside React and wired to each other. */
export function createAppServices(options: AppServicesOptions): AppServices {
  const { platform } = options;
  const ui = options.ui ?? createUiStore();
  const document = createDocumentStore({
    platform,
    ...(options.read && { read: options.read }),
    ...(options.write && { write: options.write }),
  });
  const selection = createSelectionStore();
  const playback = createPlaybackStore();
  const layout = createLayoutStore({
    document,
    ui,
    options: (view, content) =>
      viewLayoutOptions(view, { tracks: content.tracks, notation: content.notation }),
  });
  const audio = (options.audio ?? ((store) => createAudioService({ playback: store })))(playback);

  const transport = createTransportUi();

  const unsubscribe = document.subscribe((state, previous) => {
    if (state.id === previous.id && state.score === previous.score) return;
    const { id, score } = state;
    audio.setDocument(id !== undefined && score ? { id, score } : undefined);
    if (state.id !== previous.id) {
      selection.getState().reset(score?.tracks[0]?.id);
      return;
    }
    const { currentTrack } = selection.getState();
    if (score && !score.tracks.some((track) => track.id === currentTrack)) {
      selection.getState().setCurrentTrack(score.tracks[0]?.id);
    }
  });

  // After the document wiring above, so a switch reaches the audio service before the speed reset.
  const uninstallTransport = installTransport({
    audio,
    playback,
    document,
    selection,
    transport,
    ...(options.storage && { storage: options.storage }),
  });

  return {
    platform,
    ui,
    document,
    selection,
    playback,
    layout,
    audio,
    transport,
    dispose() {
      uninstallTransport();
      unsubscribe();
      layout.dispose();
      audio.dispose();
    },
  };
}
