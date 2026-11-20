import { useCallback, useSyncExternalStore } from 'react';

import type { SettingDef } from '@/state/settings';

import { useAppServices } from './services-context';

/** A setting's value, re-rendering on a change; the store returns one reference per value. */
export function useSetting<T>(def: SettingDef<T>): T {
  const { settings } = useAppServices();
  // Stable between renders, or every render would unsubscribe and subscribe again.
  const subscribe = useCallback(
    (notify: () => void) => settings.subscribe(def, notify),
    [settings, def],
  );
  return useSyncExternalStore(subscribe, () => settings.get(def));
}
