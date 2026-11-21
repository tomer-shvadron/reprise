import { createContext, use, useCallback, useMemo, useSyncExternalStore } from 'react';

import type { EditorCommandId } from '@/features/editor/commands';
import type { LibraryCommandId } from '@/features/library/commands';
import type { SoundsCommandId } from '@/features/sounds/commands';
import type { TrackCommandId } from '@/features/tracks/commands';
import type { TrainerCommandId } from '@/features/trainer/commands';
import type { TransportCommandId } from '@/features/transport/commands';

import { runCommand, type Command, type CommandRegistry } from './command-registry';
import type { AppCommandId } from './commands';
import type { EditCommandId } from './edit-commands';
import type { PracticeCommandId } from './practice-mode/commands';
import type { SelectionPillCommandId } from './selection-pill/commands';
import type { EditingStore } from '@/state/editing';
import type { SettingsStore } from '@/state/settings';

import { SHORTCUT_OVERRIDES_SETTING, type ShortcutOverrides } from './keymap';
import {
  ariaKeyShortcuts,
  formatShortcut,
  shortcutId,
  shortcutOn,
  spokenShortcut,
  type KeyboardPlatform,
  type Shortcut,
} from './keyboard';
import { bindingGroup } from './shortcut-table';

/** Every id `createAppRegistry` registers, so a mistyped id fails typecheck, not at render. */
export type RegisteredCommandId =
  | AppCommandId
  | PracticeCommandId
  | TransportCommandId
  | EditCommandId
  | TrackCommandId
  | LibraryCommandId
  | TrainerCommandId
  | EditorCommandId
  | SoundsCommandId
  | SelectionPillCommandId;

export interface CommandSource {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
  /**
   * The user's key overrides, which are what make a new source value when a key changes, so every
   * `useCommand` consumer re-renders and its tooltip shows the new key.
   */
  keys?: ShortcutOverrides;
  /**
   * Whether the score is in edit mode, which hands some keys to editor commands (see `bindCommand`).
   * A source without it reads the registry's contexts at call time, so it never re-renders on a change.
   */
  editing?: boolean | undefined;
}

/** The user's key overrides, re-rendering on a change; takes the store because `App` sits outside the services provider. */
export function useKeyOverrides(settings: Pick<SettingsStore, 'get' | 'subscribe'>) {
  const subscribe = useCallback(
    (notify: () => void) => settings.subscribe(SHORTCUT_OVERRIDES_SETTING, notify),
    [settings],
  );
  return useSyncExternalStore(subscribe, () => settings.get(SHORTCUT_OVERRIDES_SETTING));
}

/** A memoised `CommandSource` that follows the user's key overrides. */
export function useCommandSource(
  registry: CommandRegistry,
  keyboard: KeyboardPlatform,
  settings: Pick<SettingsStore, 'get' | 'subscribe'>,
  editingStore?: Pick<EditingStore, 'getState' | 'subscribe'>,
): CommandSource {
  const keys = useKeyOverrides(settings);
  const subscribeEditing = useCallback(
    (notify: () => void) => editingStore?.subscribe(notify) ?? (() => undefined),
    [editingStore],
  );
  const editing = useSyncExternalStore(subscribeEditing, () => editingStore?.getState().editing);
  return useMemo(
    () => ({ registry, keyboard, keys, editing }),
    [registry, keyboard, keys, editing],
  );
}

export const CommandSourceContext = createContext<CommandSource | undefined>(undefined);

export interface BoundCommand {
  run: () => void;
  title: string;
  /** The platform the keys are spelled for. */
  keyboard: KeyboardPlatform;
  /** The first binding as the platform prints it, e.g. `⌥C`. */
  keys: string | undefined;
  /** Every binding: this command's key and its aliases', minus keys an active context takes over. */
  bindings: readonly Shortcut[];
  /** Every binding in `aria-keyshortcuts` syntax, space-separated (the list syntax). */
  ariaKeys: string | undefined;
  /** Every binding spelled out for a screen reader, joined by " or ". */
  spoken: string | undefined;
}

interface GroupIndex {
  version: number;
  groups: Map<string, Command[]>;
  /** Commands that only run in a context, which can take a global command's key. */
  contextual: Command[];
}

// Rebuilt when the command set changes, not on every render of every control.
const indexes = new WeakMap<CommandRegistry, GroupIndex>();

function indexOf(registry: CommandRegistry): GroupIndex {
  const cached = indexes.get(registry);
  if (cached?.version === registry.version) return cached;
  const groups = new Map<string, Command[]>();
  const list = registry.list();
  for (const command of list) {
    const key = bindingGroup(command);
    groups.set(key, [...(groups.get(key) ?? []), command]);
  }
  const index = {
    version: registry.version,
    groups,
    contextual: list.filter((command) => command.context !== undefined),
  };
  indexes.set(registry, index);
  return index;
}

/**
 * A global command's key while an active context's command holds the same key, as the dispatcher
 * ranks them. Deliberately ignores `enabled`: nothing re-renders a tooltip when it flips, and the
 * rule shown to the user is simply "taken over while editing". `CommandRegistry.isShadowed` is the
 * palette's version, which also asks for `enabled` and does not filter by platform.
 */
function takenOver(source: CommandSource, command: Command, shortcut: Shortcut): boolean {
  if (command.context !== undefined) return false;
  const id = shortcutId(shortcut);
  return indexOf(source.registry).contextual.some((other) => {
    const theirs = shortcutOn(source.registry.shortcutOf(other), source.keyboard);
    return (
      theirs !== undefined &&
      shortcutId(theirs) === id &&
      other.context !== undefined &&
      source.registry.isActive(other.context)
    );
  });
}

/** A registered command's run, title and keys for a source; `useCommand` is this behind a hook. */
export function bindCommand(source: CommandSource, id: RegisteredCommandId): BoundCommand {
  const command = source.registry.get(id);
  if (!command) throw new Error(`Command "${id}" is not registered`);
  const group = indexOf(source.registry).groups.get(bindingGroup(command)) ?? [command];
  const bindings: Shortcut[] = [];
  for (const member of group) {
    const shortcut = shortcutOn(source.registry.shortcutOf(member), source.keyboard);
    if (!shortcut || takenOver(source, member, shortcut)) continue;
    // Aliases can print alike (Shift+: and :), and one cap row is enough.
    const printed = formatShortcut(shortcut, source.keyboard);
    if (!bindings.some((have) => formatShortcut(have, source.keyboard) === printed)) {
      bindings.push(shortcut);
    }
  }
  const { keyboard } = source;
  const first = bindings[0];
  return {
    run: () => {
      runCommand(command);
    },
    title: command.title,
    keyboard,
    keys: first && formatShortcut(first, keyboard),
    bindings,
    ariaKeys:
      bindings.length > 0
        ? bindings.map((shortcut) => ariaKeyShortcuts(shortcut, keyboard)).join(' ')
        : undefined,
    spoken:
      bindings.length > 0
        ? bindings.map((shortcut) => spokenShortcut(shortcut, keyboard)).join(' or ')
        : undefined,
  };
}

/** A registered command, so a click, the palette and the shortcut share one code path. */
export function useCommand(id: RegisteredCommandId): BoundCommand {
  const source = use(CommandSourceContext);
  if (!source) throw new Error('useCommand needs a CommandSourceContext');
  return bindCommand(source, id);
}
