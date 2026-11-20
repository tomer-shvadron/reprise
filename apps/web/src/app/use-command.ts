import { createContext, use } from 'react';

import type { EditorCommandId } from '@/features/editor/commands';
import type { LibraryCommandId } from '@/features/library/commands';
import type { SoundsCommandId } from '@/features/sounds/commands';
import type { TrackCommandId } from '@/features/tracks/commands';
import type { TrainerCommandId } from '@/features/trainer/commands';
import type { TransportCommandId } from '@/features/transport/commands';

import { runCommand, type CommandRegistry } from './command-registry';
import type { AppCommandId } from './commands';
import type { EditCommandId } from './edit-commands';
import type { PracticeCommandId } from './practice-mode/commands';
import { ariaKeyShortcuts, formatShortcut, shortcutOn, type KeyboardPlatform } from './keyboard';

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
  | SoundsCommandId;

export interface CommandSource {
  registry: CommandRegistry;
  keyboard: KeyboardPlatform;
}

export const CommandSourceContext = createContext<CommandSource | undefined>(undefined);

export interface BoundCommand {
  run: () => void;
  title: string;
  /** The shortcut as the platform prints it, e.g. `⌥C`. */
  keys: string | undefined;
  /** The shortcut in `aria-keyshortcuts` syntax. */
  ariaKeys: string | undefined;
}

/** A registered command's run, title and keys for a source; `useCommand` is this behind a hook. */
export function bindCommand(source: CommandSource, id: RegisteredCommandId): BoundCommand {
  const command = source.registry.get(id);
  if (!command) throw new Error(`Command "${id}" is not registered`);
  const shortcut = shortcutOn(source.registry.shortcutOf(command), source.keyboard);
  return {
    run: () => {
      runCommand(command);
    },
    title: command.title,
    keys: shortcut && formatShortcut(shortcut, source.keyboard),
    ariaKeys: shortcut && ariaKeyShortcuts(shortcut, source.keyboard),
  };
}

/** A registered command, so a click, the palette and the shortcut share one code path. */
export function useCommand(id: RegisteredCommandId): BoundCommand {
  const source = use(CommandSourceContext);
  if (!source) throw new Error('useCommand needs a CommandSourceContext');
  return bindCommand(source, id);
}
