import type { Score } from '@reprise/model';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppServices } from '@/app/services';
import { detectKey, noteTableOf, scaleName, type ScaleId } from '@/lib/insights';

export type ScaleOverlaySource = 'song' | 'section' | 'manual';

export interface ScaleOverlay {
  tonic: number;
  scaleId: ScaleId;
  /** `A minor pentatonic`, for the chip. */
  label: string;
  source: ScaleOverlaySource;
}

export interface ScaleOverlayState {
  overlay: ScaleOverlay | undefined;
  show: (tonic: number, scaleId: ScaleId, source: ScaleOverlaySource) => void;
  clear: () => void;
}

export type ScaleOverlayStore = StoreApi<ScaleOverlayState>;
export type ScaleOverlayServices = Pick<AppServices, 'document'>;

const overlays = new WeakMap<object, ScaleOverlayStore>();

/**
 * The scale the fretboard marks, one store per document store so the dock and the commands share
 * it. A song or section overlay describes one document and goes when another opens; a scale the
 * player picked stays. It is not persisted.
 */
export function scaleOverlayFor(services: ScaleOverlayServices): ScaleOverlayStore {
  let store = overlays.get(services.document);
  if (!store) {
    store = createStore<ScaleOverlayState>((set) => ({
      overlay: undefined,
      show: (tonic, scaleId, source) => {
        set({ overlay: { tonic, scaleId, label: scaleName(tonic, scaleId), source } });
      },
      clear: () => {
        set({ overlay: undefined });
      },
    }));
    const own = store;
    services.document.subscribe((state, previous) => {
      if (state.id === previous.id) return;
      if (own.getState().overlay?.source !== 'manual') own.getState().clear();
    });
    overlays.set(services.document, store);
  }
  return store;
}

/**
 * The scale of the whole song, from the key engine: `undefined` when there are too few notes to
 * call a key or no scale fits. A key with a third and no better fit reads as its major or natural
 * minor.
 */
export function songScaleOf(score: Score): { tonic: number; scaleId: ScaleId } | undefined {
  const fileKey = score.masterBars[0]?.keySignature;
  const key = detectKey(noteTableOf(score), fileKey ? { fileKey } : {});
  if (!key.found) return undefined;
  if (key.scale) return { tonic: key.tonic, scaleId: key.scale.scale };
  if (key.quality === 'none') return undefined;
  return { tonic: key.tonic, scaleId: key.quality === 'minor' ? 'aeolian' : 'ionian' };
}
