import type { Score } from '@reprise/model';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppServices } from '@/app/services';

import { defaultTonicName, scaleTitle, type ScaleSpec } from './scale-dots';
import { detectKey, noteTableOf, type ScaleId } from '@/lib/insights';

export type ScaleOverlaySource = 'song' | 'section' | 'manual';

export interface ScaleOverlay extends ScaleSpec {
  /** `A minor pentatonic`, for the chip. */
  label: string;
  source: ScaleOverlaySource;
}

export interface ScaleOverlayState {
  overlay: ScaleOverlay | undefined;
  /** `tonicName` is the spelling to keep (`E♭`); left out, the scale's own key spells it. */
  show: (tonic: number, scaleId: ScaleId, source: ScaleOverlaySource, tonicName?: string) => void;
  clear: () => void;
}

export type ScaleOverlayStore = StoreApi<ScaleOverlayState>;
export type ScaleOverlayServices = Pick<AppServices, 'document'>;

const overlays = new WeakMap<object, ScaleOverlayStore>();

/**
 * The scale the fretboard marks, one store per document store so the dock and the commands share
 * it. A song or section overlay describes one document and goes when another opens; a scale the
 * player picked stays. It is not persisted. A song overlay is a snapshot of the score when it was
 * taken and does not follow later edits; PR 5 of #353 (the insights worker and store) makes it do so.
 */
export function scaleOverlayFor(services: ScaleOverlayServices): ScaleOverlayStore {
  let store = overlays.get(services.document);
  if (!store) {
    store = createStore<ScaleOverlayState>((set) => ({
      overlay: undefined,
      show: (tonic, scaleId, source, tonicName = defaultTonicName(tonic, scaleId)) => {
        set({
          overlay: {
            tonic,
            tonicName,
            scaleId,
            label: scaleTitle({ tonicName, scaleId }),
            source,
          },
        });
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
