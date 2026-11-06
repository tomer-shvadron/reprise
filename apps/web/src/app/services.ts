import { viewLayoutOptions } from '@/features/score';
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
  dispose(): void;
}

export interface AppServicesOptions {
  platform: Platform;
  ui?: UiStore;
  audio?: (playback: PlaybackStore) => AudioService;
  read?: DocumentStoreDeps['read'];
  write?: DocumentStoreDeps['write'];
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

  return {
    platform,
    ui,
    document,
    selection,
    playback,
    layout,
    audio,
    dispose() {
      unsubscribe();
      layout.dispose();
      audio.dispose();
    },
  };
}
