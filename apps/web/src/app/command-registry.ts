import { shortcutId, type Shortcut } from './keyboard';

export interface Command {
  id: string;
  title: string;
  shortcut?: Shortcut;
  /** False keeps a command out of the palette while its shortcut still works. */
  inPalette?: boolean;
  run: () => void | Promise<void>;
}

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #shortcuts = new Map<string, string>();

  register(command: Command): () => void {
    if (this.#commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    const binding = command.shortcut && shortcutId(command.shortcut);
    if (binding !== undefined) {
      const owner = this.#shortcuts.get(binding);
      if (owner !== undefined) {
        throw new Error(`Shortcut "${binding}" of "${command.id}" is already bound to "${owner}"`);
      }
      this.#shortcuts.set(binding, command.id);
    }
    this.#commands.set(command.id, command);

    return () => {
      this.#commands.delete(command.id);
      if (binding !== undefined) this.#shortcuts.delete(binding);
    };
  }

  get(id: string): Command | undefined {
    return this.#commands.get(id);
  }

  list(): Command[] {
    return [...this.#commands.values()];
  }
}

export function runCommand(command: Command, onError: (error: unknown) => void = console.error) {
  try {
    Promise.resolve(command.run()).catch(onError);
  } catch (error) {
    onError(error);
  }
}
