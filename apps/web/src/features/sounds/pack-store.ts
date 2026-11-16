import { createStore } from 'zustand/vanilla';

import type { Platform } from '@/platform/platform';
import type { InstalledPackSource, PackDirectory } from '@/state/sound-packs';

export interface SoundPackState {
  installed: readonly InstalledPackSource[];
}

export interface SoundPackStore extends PackDirectory {
  /** What the pack manager (WP-091) scans `data/sounds` and installs through. */
  readonly platform: Platform;
  getState(): SoundPackState;
  /** Replaces the installed set and tells the directory's subscribers. */
  setInstalled(installed: readonly InstalledPackSource[]): void;
  subscribe(listener: () => void): () => void;
}

export interface SoundPackStoreOptions {
  platform: Platform;
}

/**
 * The installed sound packs, and the `PackDirectory` the audio service reads. This is the minimal
 * shape the contract (#267) fixes; the pack manager (WP-091) adds the scan of `data/sounds`, the
 * installer and the actions behind it, and uses `platform` for them.
 */
export function createSoundPackStore(options: SoundPackStoreOptions): SoundPackStore {
  const store = createStore<SoundPackState>(() => ({ installed: [] }));
  return {
    platform: options.platform,
    getState: store.getState,
    get: (id) => store.getState().installed.find((pack) => pack.id === id),
    setInstalled: (installed) => {
      store.setState({ installed });
    },
    subscribe: (listener) =>
      store.subscribe(() => {
        listener();
      }),
  };
}
