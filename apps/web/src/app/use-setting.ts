import { useSyncExternalStore } from 'react';

import type { SettingDef } from '@/state/settings';

import { useAppServices } from './services-context';

/** A setting's value, re-rendering on a change; the store returns one reference per value. */
export function useSetting<T>(def: SettingDef<T>): T {
  const { settings } = useAppServices();
  return useSyncExternalStore(
    (notify) => settings.subscribe(def, notify),
    () => settings.get(def),
  );
}
