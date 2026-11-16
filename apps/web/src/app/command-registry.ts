import { shortcutId, type Shortcut } from './keyboard';

/** A situation a binding is limited to; a command without one is bound everywhere. */
export const COMMAND_CONTEXTS = ['editing'] as const;
export type CommandContext = (typeof COMMAND_CONTEXTS)[number];

/** Precedence of a context when several are active: lower wins, a context-free command last. */
export const contextRank = (context: CommandContext | undefined): number =>
  context === undefined ? COMMAND_CONTEXTS.length : COMMAND_CONTEXTS.indexOf(context);

export interface Command {
  id: string;
  title: string;
  /**
   * What the palette searches instead of `title`, for a title that changes with state ("Undo
   * Insert bar" searches as "Undo"): typing another command's name must never match it.
   */
  searchTitle?: string;
  shortcut?: Shortcut;
  /** The shortcut works only while this context is active, and wins over a context-free binding of the same key. */
  context?: CommandContext;
  /** False keeps a command out of the palette while its shortcut still works. */
  inPalette?: boolean;
  /**
   * Whether the command can do anything now; false drops it from `available()`, so the palette
   * omits it and its shortcut does nothing. Read on each call, never cached.
   */
  enabled?: () => boolean;
  /**
   * The key belongs to the browser: the dispatcher neither runs the command nor prevents the
   * default on keydown, so the browser's own event fires (copy, cut and paste fire clipboard
   * events with the system clipboard attached). The table and the palette still show the key, and
   * `run` is the palette's way to the same action. Nothing else about the registry changes.
   */
  native?: true;
  /** False ignores auto-repeated keydowns, so holding Space does not toggle play on and off. */
  repeat?: false;
  run: () => void | Promise<void>;
}

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #shortcuts = new Map<string, string>();
  readonly #isActive: (context: CommandContext) => boolean;

  /** `isActive` tells whether a context holds now; without it, none does. */
  constructor(isActive: (context: CommandContext) => boolean = () => false) {
    this.#isActive = isActive;
  }

  isActive(context: CommandContext): boolean {
    return this.#isActive(context);
  }

  register(command: Command): () => void {
    if (this.#commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    const base = command.shortcut && shortcutId(command.shortcut);
    const binding = base === undefined ? undefined : `${command.context ?? ''}:${base}`;
    if (base !== undefined && binding !== undefined) {
      const owner = this.#shortcuts.get(binding);
      if (owner !== undefined) {
        const where = command.context ? ` in the ${command.context} context` : '';
        throw new Error(
          `Shortcut "${base}"${where} of "${command.id}" is already bound to "${owner}"`,
        );
      }
      this.#shortcuts.set(binding, command.id);
    }
    this.#commands.set(command.id, command);

    return () => {
      this.#commands.delete(command.id);
      if (binding !== undefined) this.#shortcuts.delete(binding);
    };
  }

  /** The commands usable now: those without a context and those whose context is active, minus any that report themselves not `enabled`. */
  available(): Command[] {
    return this.list().filter(
      ({ context, enabled }) =>
        (context === undefined || this.#isActive(context)) && enabled?.() !== false,
    );
  }

  /** Whether an available command of an active context owns this command's shortcut instead. */
  isShadowed(command: Command): boolean {
    if (command.context !== undefined || !command.shortcut) return false;
    const id = shortcutId(command.shortcut);
    return this.available().some(
      (other) => other.context !== undefined && other.shortcut && shortcutId(other.shortcut) === id,
    );
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
