import { createContext, use } from 'react';

import type { CommandRegistry } from '../command-registry';
import type { KeyboardPlatform } from '../keyboard';
import type { MenuRegistry } from './menu-registry';

/** The menus beside the registry they were checked against, for a surface that mirrors menu items. */
export interface MenuRegistryValue {
  menus: MenuRegistry;
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
}

/** Provided by `App`, next to `CommandSourceContext`; the context menu host takes its props. */
export const MenuRegistryContext = createContext<MenuRegistryValue | undefined>(undefined);

export function useMenuRegistry(): MenuRegistryValue {
  const value = use(MenuRegistryContext);
  if (!value) throw new Error('useMenuRegistry needs a MenuRegistryContext');
  return value;
}
