import { createContext, use } from 'react';

import { runCommand, type CommandRegistry } from './command-registry';
import { ariaKeyShortcuts, formatShortcut, shortcutOn, type KeyboardPlatform } from './keyboard';

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
export function useCommand(id: string): BoundCommand {
  const source = use(CommandSourceContext);
  if (!source) throw new Error('useCommand needs a CommandSourceContext');
  const command = source.registry.get(id);
  if (!command) throw new Error(`Command "${id}" is not registered`);
  const shortcut = shortcutOn(command.shortcut, source.keyboard);
  return {
    run: () => {
      runCommand(command);
    },
    title: command.title,
    keys: shortcut && formatShortcut(shortcut, source.keyboard),
    ariaKeys: shortcut && ariaKeyShortcuts(shortcut, source.keyboard),
  };
}
