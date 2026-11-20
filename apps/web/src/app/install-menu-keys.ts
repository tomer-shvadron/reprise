import type { MenuCommandId, MenuKey, MenuKeys } from '@/platform/bridge';
import { MENU_COMMAND_IDS } from '@/platform/bridge';
import type { Platform } from '@/platform/platform';
import type { SettingsStore } from '@/state/settings';

import type { CommandRegistry } from './command-registry';
import { shortcutOn, type KeyboardPlatform, type Shortcut } from './keyboard';

const NAMED_KEYS =
  /^(F([1-9]|1\d|2[0-4])|Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown|Enter)$/;

/**
 * The key as the menu can carry it: one printable ASCII character, or a name the accelerator
 * grammar has. Anything else (a non-ASCII character) gives `null`: the menu then shows no key for
 * that item, while the renderer still fires it.
 */
export function menuKeyOf(shortcut: Shortcut | undefined): MenuKey | null {
  if (!shortcut) return null;
  const { key } = shortcut;
  if (!/^[\x20-\x7e]$/.test(key) && !NAMED_KEYS.test(key)) return null;
  return {
    key,
    ...(shortcut.mod && { mod: true }),
    ...(shortcut.shift && { shift: true }),
    ...(shortcut.alt && { alt: true }),
  };
}

/** The key of every menu command as the registry has it now, `null` for one with no key. */
export function menuKeysOf(registry: CommandRegistry, keyboard: KeyboardPlatform): MenuKeys {
  const keys: Partial<Record<MenuCommandId, MenuKey | null>> = {};
  for (const id of MENU_COMMAND_IDS) {
    const command = registry.get(id);
    keys[id] = command ? menuKeyOf(shortcutOn(registry.shortcutOf(command), keyboard)) : null;
  }
  return keys;
}

/**
 * Gives the native menu its keys from the registry, so the menu has no key list of its own. The
 * first push waits for the settings to load, so a stored change never shows as a flash of the
 * default; `subscribe` (a change of the keymap) re-pushes, and an unchanged map is not resent.
 * Does nothing on a platform without a menu. Returns the undo.
 */
export function installMenuKeys(deps: {
  registry: CommandRegistry;
  settings: Pick<SettingsStore, 'whenHydrated'>;
  platform: Pick<Platform, 'setMenuKeys'>;
  keyboard: KeyboardPlatform;
  subscribe?: (listener: () => void) => () => void;
}): () => void {
  const { registry, settings, platform, keyboard, subscribe } = deps;
  const { setMenuKeys } = platform;
  if (!setMenuKeys) return () => undefined;
  let last = '';
  let active = true;
  const push = () => {
    if (!active) return;
    const keys = menuKeysOf(registry, keyboard);
    const text = JSON.stringify(keys);
    if (text === last) return;
    last = text;
    setMenuKeys.call(platform, keys);
  };
  let stop: (() => void) | undefined;
  void settings.whenHydrated().then(() => {
    if (!active) return;
    push();
    stop = subscribe?.(push);
  });
  return () => {
    active = false;
    stop?.();
  };
}
