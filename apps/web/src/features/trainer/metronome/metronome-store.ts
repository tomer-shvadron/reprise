import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AppServices } from '@/app/services';

import { clampBeats, clickBeats, countsDotted, type Denominator, type Meter } from './meter';

export type MetronomeServices = Pick<AppServices, 'audio' | 'playback'>;

export interface MetronomeState extends Meter {
  setNumerator: (numerator: number) => void;
  setDenominator: (denominator: Denominator) => void;
  setDotted: (dotted: boolean) => void;
}

export type MetronomeStore = StoreApi<MetronomeState>;

/** Outside React so the meter survives the panel unmounting, as the click's own settings do. */
export function createMetronomeStore({ audio, playback }: MetronomeServices): MetronomeStore {
  const store = createStore<MetronomeState>((set, get) => {
    const change = (partial: Partial<Meter>) => {
      const before = get();
      const after: Meter = { ...before, ...partial };
      set(partial);
      // Counting in dotted beats clicks the three eighths of each: its subdivision is 3.
      const subdivision =
        countsDotted(after) === countsDotted(before) ? undefined : countsDotted(after) ? 3 : 1;
      audio.updateClick({
        beatsPerBar: clickBeats(after),
        ...(subdivision && { subdivision }),
      });
    };
    return {
      numerator: playback.getState().click.settings.beatsPerBar,
      denominator: 4,
      dotted: true,
      setNumerator: (numerator) => {
        change({ numerator: clampBeats(numerator) });
      },
      setDenominator: (denominator) => {
        change({ denominator });
      },
      setDotted: (dotted) => {
        change({ dotted });
      },
    };
  });
  return store;
}

const stores = new WeakMap<object, MetronomeStore>();

/** One store per services, shared by the panel and anything else that needs the meter. */
export function metronomeFor(services: MetronomeServices): MetronomeStore {
  let store = stores.get(services.playback);
  if (!store) {
    store = createMetronomeStore(services);
    stores.set(services.playback, store);
  }
  return store;
}
