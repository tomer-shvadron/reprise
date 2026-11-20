import type { CommandRegistry } from '../command-registry';
import type { RegisteredCommandId } from '../use-command';
import {
  MENU_GROUPS,
  MENU_SURFACES,
  type MenuContribution,
  type MenuItemSpec,
  type MenuMode,
  type MenuSurface,
} from './types';

/** An item with its command ids listed and its modes filled in. */
export interface MenuItem extends Omit<MenuItemSpec, 'command' | 'modes'> {
  /** One id, or the platform twins in order. */
  commands: readonly RegisteredCommandId[];
  modes: readonly MenuMode[];
}

export interface MenuRegistry {
  /** The items of a surface in contribution order, across every contribution that names it. */
  itemsOf(surface: MenuSurface): readonly MenuItem[];
  surfaces(): readonly MenuSurface[];
}

/**
 * Checks every contribution against the command registry and returns the menus. It refuses what
 * would break the mode rule at registration, so a bad item fails at startup and in the acceptance
 * test, never when someone right-clicks: an unknown command, an unknown surface or group, and an
 * editing command offered in play mode.
 */
export function createMenuRegistry(
  registry: CommandRegistry,
  contributions: readonly MenuContribution[],
): MenuRegistry {
  const bySurface = new Map<MenuSurface, MenuItem[]>();
  for (const { surface, items } of contributions) {
    if (!MENU_SURFACES.includes(surface)) throw new Error(`Unknown menu surface "${surface}"`);
    // A surface with no items of its own still has a menu: a note's is its beat's and bar's.
    if (!bySurface.has(surface)) bySurface.set(surface, []);
    for (const spec of items) {
      const { command, modes, ...rest } = spec;
      const commands = typeof command === 'string' ? [command] : [...command];
      if (commands.length === 0) throw new Error(`A ${surface} item names no command`);
      if (!MENU_GROUPS.includes(spec.group)) {
        throw new Error(`Unknown menu group "${spec.group}" on ${surface}`);
      }
      let editing = false;
      for (const id of commands) {
        const known = registry.get(id);
        if (!known) throw new Error(`The ${surface} menu names unknown command "${id}"`);
        if (known.context === 'editing') editing = true;
      }
      if (editing && modes?.includes('play')) {
        throw new Error(
          `The ${surface} menu lists editing command "${commands.join(', ')}" in play mode`,
        );
      }
      const item: MenuItem = {
        ...rest,
        commands,
        modes: modes ?? (editing ? ['edit'] : ['play', 'edit']),
      };
      bySurface.set(surface, [...(bySurface.get(surface) ?? []), item]);
    }
  }
  return {
    itemsOf: (surface) => bySurface.get(surface) ?? [],
    surfaces: () => [...bySurface.keys()],
  };
}
