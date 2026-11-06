import { createContext, use } from 'react';

import { runCommand, type CommandRegistry } from '@/app/command-registry';
import { ariaKeyShortcuts, formatShortcut, type KeyboardPlatform } from '@/app/keyboard';

import type { TransportCommandId } from './commands';

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

/** A registered command, so a click, the palette and the shortcut share one code path. */
export function useCommand(id: TransportCommandId): BoundCommand {
  const source = use(CommandSourceContext);
  if (!source) throw new Error('useCommand needs a CommandSourceContext');
  const command = source.registry.get(id);
  if (!command) throw new Error(`Command "${id}" is not registered`);
  const { shortcut } = command;
  return {
    run: () => {
      runCommand(command);
    },
    title: command.title,
    keys: shortcut && formatShortcut(shortcut, source.keyboard),
    ariaKeys: shortcut && ariaKeyShortcuts(shortcut, source.keyboard),
  };
}
