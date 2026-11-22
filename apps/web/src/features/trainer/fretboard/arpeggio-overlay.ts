import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppServices } from '@/app/services';

import { insightsFor } from '../insights/insights-for';

export type ArpeggioLabels = 'degree' | 'name';

/** What the overlay has to say about the chord for the moment shown. */
export type ShownChord =
  | { kind: 'chord'; name: string; source: 'written' | 'inferred' | 'held' }
  /** Follow is on and the song's chords are not in yet. */
  | { kind: 'finding' }
  /** Follow is on and no chord sounds at this moment. */
  | { kind: 'none-here' }
  /** Follow is on and the song names or implies no chords. */
  | { kind: 'no-chords' }
  /** Follow is on and the analysis failed. */
  | { kind: 'unavailable' }
  /** Follow is off and nothing has been picked. */
  | { kind: 'pick' };

export interface ArpeggioOverlayState {
  on: boolean;
  /** The chord follows the moment the lit notes show; off holds `held`. */
  follow: boolean;
  labels: ArpeggioLabels;
  /** The chord a hold keeps, as written (`Am7`). */
  held: string | undefined;
  shown: ShownChord;
  /** Turns the overlay on with the current follow setting. */
  turnOn: () => void;
  turnOff: () => void;
  /** Off holds the chord shown now; on goes back to the song's chords. */
  setFollow: (follow: boolean) => void;
  setLabels: (labels: ArpeggioLabels) => void;
  /** Holds this chord and turns follow off and the overlay on. */
  hold: (name: string) => void;
  /** The fretboard's per-frame lookup reports the chord at the moment. */
  setShown: (shown: ShownChord) => void;
}

export type ArpeggioOverlayStore = StoreApi<ArpeggioOverlayState>;
export type ArpeggioOverlayServices = Pick<AppServices, 'document'>;

const overlays = new WeakMap<object, ArpeggioOverlayStore>();

const heldShown = (held: string | undefined): ShownChord =>
  held ? { kind: 'chord', name: held, source: 'held' } : { kind: 'pick' };

/**
 * The chord tones the fretboard marks, one store per document store so the dock, the commands and
 * the panels share it. It is not persisted. While it is on and following it retains the insights
 * store, whose chord timeline the fretboard reads each frame; it lets go otherwise. A held chord is
 * the player's own choice, so it stays when another document opens.
 */
export function arpeggioOverlayFor(services: ArpeggioOverlayServices): ArpeggioOverlayStore {
  let store = overlays.get(services.document);
  if (!store) {
    store = createStore<ArpeggioOverlayState>((set, get) => ({
      on: false,
      follow: true,
      labels: 'degree',
      held: undefined,
      shown: { kind: 'finding' },
      turnOn: () => {
        const { on, follow, held } = get();
        if (on) return;
        set({ on: true, shown: follow ? { kind: 'finding' } : heldShown(held) });
      },
      turnOff: () => {
        set({ on: false });
      },
      setFollow: (follow) => {
        const { shown, held } = get();
        if (follow) {
          set({ follow: true, held: undefined, shown: { kind: 'finding' } });
        } else {
          const keep = shown.kind === 'chord' ? shown.name : held;
          set({ follow: false, held: keep, shown: heldShown(keep) });
        }
      },
      setLabels: (labels) => {
        set({ labels });
      },
      hold: (name) => {
        set({ on: true, follow: false, held: name, shown: heldShown(name) });
      },
      setShown: (shown) => {
        const current = get().shown;
        if (
          current.kind === shown.kind &&
          (current.kind !== 'chord' ||
            (shown.kind === 'chord' &&
              current.name === shown.name &&
              current.source === shown.source))
        ) {
          return;
        }
        set({ shown });
      },
    }));
    const own = store;
    const insights = insightsFor(services);
    let retained = false;
    own.subscribe((state) => {
      const wants = state.on && state.follow;
      if (wants === retained) return;
      retained = wants;
      if (wants) insights.getState().retain();
      else insights.getState().release();
    });
    overlays.set(services.document, store);
  }
  return store;
}
