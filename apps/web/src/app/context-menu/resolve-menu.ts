import type { Command, CommandRegistry } from '../command-registry';
import { shortcutOn, type KeyboardPlatform } from '../keyboard';
import type { RegisteredCommandId } from '../use-command';
import type { MenuItem, MenuRegistry } from './menu-registry';
import {
  MENU_GROUPS,
  SURFACE_PARENTS,
  SURFACE_SUBMENU_TITLES,
  type MenuContext,
  type MenuGroup,
  type MenuSurface,
} from './types';

export type ResolvedEntry =
  | {
      kind: 'item';
      id: RegisteredCommandId;
      command: Command;
      label: string;
      enabled: boolean;
      /** Set for a checkbox item. */
      checked: boolean | undefined;
      group: MenuGroup;
    }
  | { kind: 'separator' }
  | { kind: 'submenu'; title: string; entries: ResolvedEntry[] };

interface Candidate {
  id: RegisteredCommandId;
  command: Command;
  item: MenuItem;
}

/** The first twin bound on this platform, else the first one. */
function pick(
  item: MenuItem,
  registry: CommandRegistry,
  keyboard: KeyboardPlatform,
): Pick<Candidate, 'id' | 'command'> | undefined {
  const commands = item.commands.flatMap((id) => {
    const command = registry.get(id);
    return command ? [{ id, command }] : [];
  });
  return (
    commands.find(({ command }) => shortcutOn(registry.shortcutOf(command), keyboard)) ??
    commands[0]
  );
}

function candidates(
  menus: MenuRegistry,
  registry: CommandRegistry,
  surface: MenuSurface,
  at: MenuContext,
  keyboard: KeyboardPlatform,
): Candidate[] {
  const found: Candidate[] = [];
  for (const item of menus.itemsOf(surface)) {
    if (!item.modes.includes(at.mode)) continue;
    if (item.when && !item.when(at)) continue;
    const picked = pick(item, registry, keyboard);
    if (!picked) continue;
    const { id, command } = picked;
    if (command.context !== undefined && !registry.isActive(command.context)) continue;
    // Whatever the registration allowed, a command of any context (each is a refinement of edit
    // mode) never shows in play mode.
    if (command.context !== undefined && at.mode === 'play') continue;
    found.push({ id, command, item });
  }
  return found;
}

type ResolvedItem = Extract<ResolvedEntry, { kind: 'item' }>;

function itemOf({ id, command, item }: Candidate, at: MenuContext): ResolvedItem {
  return {
    kind: 'item',
    id,
    command,
    label: typeof item.label === 'function' ? item.label(at) : (item.label ?? command.title),
    enabled: command.enabled?.() !== false,
    checked: item.checked?.(at),
    group: item.group,
  };
}

/** Orders by group, then contribution order; one entry per command; a separator between groups. */
function entriesOf(found: readonly Candidate[], at: MenuContext): ResolvedEntry[] {
  const seen = new Set<string>();
  const unique = found.filter(({ command }) => {
    if (seen.has(command.id)) return false;
    seen.add(command.id);
    return true;
  });
  const entries: ResolvedEntry[] = [];
  for (const group of MENU_GROUPS) {
    const inGroup = unique.filter(({ item }) => item.group === group);
    if (inGroup.length === 0) continue;
    if (entries.length > 0) entries.push({ kind: 'separator' });
    for (const candidate of inGroup) entries.push(itemOf(candidate, at));
  }
  return entries;
}

/**
 * The resolved items for `ids` on one surface and its parent levels, flat and in `ids` order: the
 * resolution the menu itself uses (modes, `when`, the command's context, the mode rule, label,
 * `checked`, a disabled command kept, disabled), for a surface that mirrors some of the menu's
 * items, such as the selection pill. An id the menu does not offer here is left out. Where a
 * level and its parent both name a command, the level's own item wins, as in the menu.
 */
export function resolveItems(
  menus: MenuRegistry,
  registry: CommandRegistry,
  surface: MenuSurface,
  at: MenuContext,
  keyboard: KeyboardPlatform,
  ids: readonly RegisteredCommandId[],
): ResolvedItem[] {
  const found = [surface, ...(SURFACE_PARENTS[surface] ?? [])].flatMap((level) =>
    candidates(menus, registry, level, at, keyboard),
  );
  return ids.flatMap((id) => {
    const candidate = found.find((entry) => entry.command.id === id);
    return candidate ? [itemOf(candidate, at)] : [];
  });
}

/**
 * The entries of one surface's menu for one target, pure over the registries and the context.
 * An item whose `modes` lacks the mode, whose command's context is not active or whose `when` is
 * false is dropped; one whose command reports itself not `enabled` stays, disabled. Score levels
 * nest (see `SURFACE_PARENTS`): in play mode a parent level's items are merged flat, in edit mode
 * each parent becomes a submenu, so edit menus stay short.
 */
export function resolveMenu(
  menus: MenuRegistry,
  registry: CommandRegistry,
  surface: MenuSurface,
  at: MenuContext,
  keyboard: KeyboardPlatform,
): ResolvedEntry[] {
  const own = candidates(menus, registry, surface, at, keyboard);
  const parents = SURFACE_PARENTS[surface] ?? [];
  if (at.mode === 'play') {
    const merged = [
      ...own,
      ...parents.flatMap((parent) => candidates(menus, registry, parent, at, keyboard)),
    ];
    return entriesOf(merged, at);
  }
  const entries = entriesOf(own, at);
  const shown = new Set(own.map(({ command }) => command.id));
  for (const parent of parents) {
    const sub = entriesOf(
      candidates(menus, registry, parent, at, keyboard).filter(
        ({ command }) => !shown.has(command.id),
      ),
      at,
    );
    if (sub.length === 0) continue;
    for (const entry of sub) if (entry.kind === 'item') shown.add(entry.command.id);
    if (entries.length > 0) entries.push({ kind: 'separator' });
    entries.push({
      kind: 'submenu',
      title: SURFACE_SUBMENU_TITLES[parent] ?? parent,
      entries: sub,
    });
  }
  return entries;
}

/** Every command an entry list names, submenus included. */
export function commandsIn(entries: readonly ResolvedEntry[]): Command[] {
  return entries.flatMap((entry) =>
    entry.kind === 'item'
      ? [entry.command]
      : entry.kind === 'submenu'
        ? commandsIn(entry.entries)
        : [],
  );
}
