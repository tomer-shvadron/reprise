import { shortcutId, shortcutOn, type KeyboardPlatform, type Shortcut } from './keyboard';

const PLATFORMS: readonly KeyboardPlatform[] = ['mac', 'other'];

export interface ShortcutConflict {
  /** The shared binding, as `shortcutId` spells it. */
  key: string;
  context: CommandContext | undefined;
  first: string;
  second: string;
}

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
  /** False keeps the key out of the user's hands (Settings > Keyboard): typed values, not shortcuts. */
  rebindable?: false;
  run: () => void | Promise<void>;
}

/**
 * Two commands bound to one key in one context on one platform, by the keys `shortcutOf` gives.
 * Pure, so the registry, the doc test and the Keyboard section's preview share one algorithm.
 */
export function findConflicts(
  commands: readonly Command[],
  shortcutOf: (command: Command) => Shortcut | undefined,
): ShortcutConflict[] {
  const owners = new Map<string, string>();
  const found: ShortcutConflict[] = [];
  for (const command of commands) {
    const shortcut = shortcutOf(command);
    if (!shortcut) continue;
    for (const platform of PLATFORMS) {
      if (!shortcutOn(shortcut, platform)) continue;
      const key = shortcutId(shortcut);
      const binding = `${platform}:${command.context ?? ''}:${key}`;
      const owner = owners.get(binding);
      if (owner === undefined) owners.set(binding, command.id);
      else if (!found.some((c) => c.first === owner && c.second === command.id)) {
        found.push({ key, context: command.context, first: owner, second: command.id });
      }
    }
  }
  return found;
}

export class CommandRegistry {
  readonly #commands = new Map<string, Command>();
  readonly #isActive: (context: CommandContext) => boolean;
  readonly #keys: (command: Command) => Shortcut | undefined;
  #version = 0;

  /**
   * `isActive` tells whether a context holds now; without it, none does. `keys` is the one place
   * that decides which key a command has: the default is the command's own `shortcut`, and a layer
   * of user overrides wraps it here, so the dispatcher, palette, tooltips, cheat sheet and the
   * generated reference all follow it.
   */
  constructor(
    isActive: (context: CommandContext) => boolean = () => false,
    keys: (command: Command) => Shortcut | undefined = (command) => command.shortcut,
  ) {
    this.#isActive = isActive;
    this.#keys = keys;
  }

  /** Changes whenever a command is registered or unregistered, so a key resolver can cache against the set. */
  get version(): number {
    return this.#version;
  }

  /** The key the command answers to now: every reader of a command's key goes through this. */
  shortcutOf(command: Command): Shortcut | undefined {
    return this.#keys(command);
  }

  isActive(context: CommandContext): boolean {
    return this.#isActive(context);
  }

  /**
   * Two commands bound to one key in one context on one platform, by the keys they answer to
   * now. The single check behind `register`, the doc test and any override layer, which calls it
   * to refuse or flag an override. It compares the bindings as declared: the physical-key
   * fallback of non-Latin layouts is not visible here (#242).
   */
  conflicts(): ShortcutConflict[] {
    return findConflicts(this.list(), (command) => this.shortcutOf(command));
  }

  register(command: Command): () => void {
    if (this.#commands.has(command.id)) {
      throw new Error(`Command "${command.id}" is already registered`);
    }
    this.#commands.set(command.id, command);
    this.#version += 1;
    const clash = this.conflicts().find((conflict) => conflict.second === command.id);
    if (clash) {
      this.#commands.delete(command.id);
      this.#version += 1;
      const where = clash.context ? ` in the ${clash.context} context` : '';
      throw new Error(
        `Shortcut "${clash.key}"${where} of "${command.id}" is already bound to "${clash.first}"`,
      );
    }
    return () => {
      this.#commands.delete(command.id);
      this.#version += 1;
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
    const own = this.shortcutOf(command);
    if (command.context !== undefined || !own) return false;
    const id = shortcutId(own);
    return this.available().some((other) => {
      const theirs = this.shortcutOf(other);
      return other.context !== undefined && theirs !== undefined && shortcutId(theirs) === id;
    });
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
