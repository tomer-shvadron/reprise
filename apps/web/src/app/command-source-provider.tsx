import type { ReactNode } from 'react';
import type { EditingStore } from '@/state/editing';
import type { SettingsStore } from '@/state/settings';

import type { CommandRegistry } from './command-registry';
import type { KeyboardPlatform } from './keyboard';
import { CommandSourceContext, useCommandSource } from './use-command';

interface CommandSourceProviderProps {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
  settings: Pick<SettingsStore, 'get' | 'subscribe'>;
  editing: Pick<EditingStore, 'getState' | 'subscribe'>;
  children: ReactNode;
}

/**
 * Holds the subscriptions to the key overrides and to edit mode, so only the context's consumers
 * render again when either changes; `children` keep their element identity in the parent.
 */
export function CommandSourceProvider({
  registry,
  keyboard,
  settings,
  editing,
  children,
}: CommandSourceProviderProps) {
  const source = useCommandSource(registry, keyboard, settings, editing);
  return <CommandSourceContext value={source}>{children}</CommandSourceContext>;
}
