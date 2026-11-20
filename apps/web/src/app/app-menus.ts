import { editorMenus } from '@/features/editor/menus';
import { trainerMenus } from '@/features/trainer/menus';
import { transportMenus } from '@/features/transport/menus';

import type { CommandRegistry } from './command-registry';
import { createMenuRegistry, type MenuRegistry } from './context-menu/menu-registry';
import { shellMenus } from './context-menu/shell-menus';
import type { MenuContribution } from './context-menu/types';

/**
 * Every menu contribution of the app, the way `app-registry.ts` lists the commands. A feature
 * that adds items to a surface exports them from a `menus.ts` beside its `commands.ts` and adds
 * one line here; it touches nothing under `context-menu/`.
 */
export const appMenuContributions: readonly MenuContribution[] = [
  ...shellMenus,
  ...transportMenus,
  ...trainerMenus,
  ...editorMenus,
];

/** The menus, checked against the registry: a bad item throws here, at startup. */
export function createAppMenus(registry: CommandRegistry): MenuRegistry {
  return createMenuRegistry(registry, appMenuContributions);
}
