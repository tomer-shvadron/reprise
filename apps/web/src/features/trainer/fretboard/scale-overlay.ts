import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppServices } from '@/app/services';

import type { ScaleId, SongInsights } from '@/lib/insights';

import { insightsFor } from '../insights/insights-for';

import { defaultTonicName, scaleTitle, type ScaleSpec } from './scale-dots';

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

type Found = { tonic: number; scaleId: ScaleId };

const overlays = new WeakMap<object, ScaleOverlayStore>();

/**
 * The scale the fretboard marks, one store per document store so the dock and the commands share
 * it. A song or section overlay describes one document and goes when another opens; a scale the
 * player picked stays. It is not persisted. A song overlay retains the insights store and follows
 * it, so it moves with the song's scale as the score is edited and goes when there is none.
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
    followSong(services, own);
  }
  return store;
}

/**
 * A song overlay keeps the insights store retained, so the analysis runs while it shows, and
 * takes each new result's scale (or clears when the song no longer has one).
 */
function followSong(services: ScaleOverlayServices, overlays: ScaleOverlayStore) {
  const insights = insightsFor(services);
  let retained = false;
  const apply = () => {
    const { overlay } = overlays.getState();
    if (overlay?.source !== 'song') return;
    const { insights: result, forScore, status } = insights.getState();
    if (status !== 'ready' || !result || forScore !== services.document.getState().score) return;
    const found = songScaleOf(result);
    if (!found) {
      overlays.getState().clear();
      return;
    }
    if (found.tonic !== overlay.tonic || found.scaleId !== overlay.scaleId) {
      overlays.getState().show(found.tonic, found.scaleId, 'song');
    }
  };
  overlays.subscribe((state) => {
    const wants = state.overlay?.source === 'song';
    if (wants !== retained) {
      retained = wants;
      if (wants) insights.getState().retain();
      else insights.getState().release();
    }
    // A result already in hand is what a song overlay shows, whoever set it.
    if (wants) apply();
  });
  insights.subscribe(apply);
}

/**
 * The scale of the whole song, from its insights: `undefined` when there are too few notes to
 * call a key or no scale fits. A key with a third and no better fit reads as its major or natural
 * minor.
 */
export function songScaleOf({ key }: SongInsights): Found | undefined {
  if (!key.found) return undefined;
  if (key.scale) return { tonic: key.tonic, scaleId: key.scale.scale };
  if (key.quality === 'none') return undefined;
  return { tonic: key.tonic, scaleId: key.quality === 'minor' ? 'aeolian' : 'ionian' };
}
