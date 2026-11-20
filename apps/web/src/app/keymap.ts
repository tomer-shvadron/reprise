import { z } from 'zod';

import { defineSetting, type SettingsStore } from '@/state/settings';

import { findConflicts, type Command, type CommandRegistry } from './command-registry';
import { shortcutId, shortcutOn, type KeyboardPlatform, type Shortcut } from './keyboard';

const NAMED_KEYS: ReadonlySet<string> = new Set([
  ...Array.from({ length: 24 }, (_, i) => `F${String(i + 1)}`),
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Enter',
  'Backspace',
  'Delete',
  'Insert',
]);

/** One printable code point (Space included) or a named key of a fixed list; Escape and Tab are not on it. */
export function isShortcutKey(key: string): boolean {
  return NAMED_KEYS.has(key) || isShortcutCharacter(key);
}

/** One printable code point, Space included. */
export function isShortcutCharacter(key: string): boolean {
  return key === ' ' || /^[^\p{C}\s]$/u.test(key);
}

/** A key as the user recorded it: the Shortcut shape minus `only`, plus the physical key. */
export const KEY_BINDING_SCHEMA = z.strictObject({
  key: z.string().refine(isShortcutKey, 'not a key a shortcut can use'),
  mod: z.boolean().optional(),
  shift: z.boolean().optional(),
  alt: z.boolean().optional(),
  /** `KeyboardEvent.code` when recorded. Stored for #242, not read by the matcher here. */
  code: z.string().max(32).optional(),
});
export type KeyBinding = z.infer<typeof KEY_BINDING_SCHEMA>;

/**
 * Command id to its key, or `null` for "no key". An absent entry means the default. A bad entry is
 * dropped on its own (`catch`), so one hand-edited value does not wipe every override.
 */
export const SHORTCUT_OVERRIDES_SETTING = defineSetting({
  key: 'keyboard.shortcuts',
  schema: z.record(z.string().max(128), KEY_BINDING_SCHEMA.nullable().optional().catch(undefined)),
  default: {},
});
export type ShortcutOverrides = Record<string, KeyBinding | null | undefined>;

/** Whether the user may give this command another key. */
export function isRebindable(command: Command): boolean {
  return !command.native && command.rebindable !== false && command.shortcut?.key !== 'Escape';
}

/** Why a command's key is fixed, for the read-only row. */
export function fixedReason(command: Command): string | undefined {
  if (command.native) return 'Set by the system';
  if (command.rebindable === false) return 'Typed values, not shortcuts';
  if (command.shortcut?.key === 'Escape') return 'Escape always backs out';
  return undefined;
}

export const stamp = (binding: KeyBinding, platform: KeyboardPlatform): Shortcut => ({
  key: binding.key,
  ...(binding.mod && { mod: true }),
  ...(binding.shift && { shift: true }),
  ...(binding.alt && { alt: true }),
  only: platform,
});

/** The id `shortcutId` gives the same keystroke, for comparing a binding with a shortcut. */
export const bindingId = (binding: KeyBinding): string => shortcutId(stamp(binding, 'other'));

export function toBinding(shortcut: Shortcut): KeyBinding {
  return {
    key: shortcut.key,
    ...(shortcut.mod && { mod: true }),
    ...(shortcut.shift && { shift: true }),
    ...(shortcut.alt && { alt: true }),
  };
}

const slotOf = (command: Command, shortcut: Shortcut) =>
  `${command.context ?? ''}:${shortcutId(shortcut)}`;

export interface EffectiveKeys {
  keys: Map<string, Shortcut | undefined>;
  /** A default that lost its key to an override: the loser's id to the winner's. */
  displacedBy: Map<string, string>;
}

/**
 * The key of every command with the overrides applied, in two passes in registration order: the
 * overrides claim their keys, then each default is kept unless an override claimed it in the same
 * context. Conflict-free by construction, which is what lets `register` keep throwing on a real
 * clash between defaults.
 */
export function effectiveKeys(
  commands: readonly Command[],
  overrides: ShortcutOverrides,
  platform: KeyboardPlatform,
): EffectiveKeys {
  const keys = new Map<string, Shortcut | undefined>();
  const displacedBy = new Map<string, string>();
  const claimed = new Map<string, string>();
  const overridden = new Set<string>();
  // A key that cannot be changed is never given away, whatever a stored override says.
  for (const command of commands) {
    const own = isRebindable(command) ? undefined : shortcutOn(command.shortcut, platform);
    if (own) claimed.set(slotOf(command, own), command.id);
  }
  for (const command of commands) {
    const entry = overrides[command.id];
    if (entry === undefined || !isRebindable(command)) continue;
    overridden.add(command.id);
    if (entry === null) {
      keys.set(command.id, undefined);
      continue;
    }
    const shortcut = stamp(entry, platform);
    const slot = slotOf(command, shortcut);
    // Only corrupt data gets here, since the recorder never writes two commands one key.
    const holder = claimed.get(slot);
    if (holder !== undefined) {
      keys.set(command.id, undefined);
      displacedBy.set(command.id, holder);
      continue;
    }
    claimed.set(slot, command.id);
    keys.set(command.id, shortcut);
  }
  for (const command of commands) {
    if (overridden.has(command.id)) continue;
    if (!isRebindable(command)) {
      keys.set(command.id, command.shortcut);
      continue;
    }
    const own = shortcutOn(command.shortcut, platform);
    const owner = own && claimed.get(slotOf(command, own));
    if (owner !== undefined) {
      keys.set(command.id, undefined);
      displacedBy.set(command.id, owner);
    } else {
      keys.set(command.id, command.shortcut);
    }
  }
  return { keys, displacedBy };
}

/**
 * The function the registry's constructor takes as `keys`: the effective key of a command. It is
 * cached on the overrides value (the store hands back one reference per value) and the registry's
 * command set.
 */
export function createKeymapResolver(
  settings: Pick<SettingsStore, 'get'>,
  platform: KeyboardPlatform,
  registry: () => CommandRegistry,
): (command: Command) => Shortcut | undefined {
  let cache: { overrides: ShortcutOverrides; version: number; keys: EffectiveKeys } | undefined;
  return (command) => {
    const current = registry();
    const overrides = settings.get(SHORTCUT_OVERRIDES_SETTING);
    if (!cache || cache.overrides !== overrides || cache.version !== current.version) {
      cache = {
        overrides,
        version: current.version,
        keys: effectiveKeys(current.list(), overrides, platform),
      };
    }
    return cache.keys.keys.has(command.id) ? cache.keys.keys.get(command.id) : command.shortcut;
  };
}

/**
 * The overrides with one command's key set: a binding, `null` for no key, or `'default'` to drop
 * the override. The one writer of the map, so it holds only real changes: an entry that equals the
 * default on this platform, or that clears a command with no default, is removed.
 */
export function withBinding(
  overrides: ShortcutOverrides,
  command: Command,
  change: KeyBinding | null | 'default',
  platform: KeyboardPlatform,
): ShortcutOverrides {
  const next: ShortcutOverrides = Object.fromEntries(
    Object.entries(overrides).filter(([id]) => id !== command.id),
  );
  const own = shortcutOn(command.shortcut, platform);
  const isDefault =
    change === 'default' ||
    (change === null ? own === undefined : own !== undefined && sameKey(own, change));
  if (!isDefault) next[command.id] = change;
  return next;
}

const sameKey = (a: Shortcut, b: KeyBinding) => shortcutId(a) === bindingId(b);

export type KeyPlan =
  | { kind: 'same' }
  | {
      kind: 'ok';
      overrides: ShortcutOverrides;
      /** The key now shadows (`over`) or is shadowed by (`under`) a command of the other context. */
      shadow?: { kind: 'over' | 'under'; other: Command };
    }
  | { kind: 'conflict'; other: Command; overrides: ShortcutOverrides; otherGets?: Shortcut }
  | { kind: 'refused'; other: Command };

/**
 * What giving `command` a key would do, by the registry's own conflict rule (same context, same
 * key). A key held by a fixed command is refused; one held by a rebindable command offers a swap
 * that gives that command this command's key; one held in the other context just goes through.
 */
export function planChange(
  commands: readonly Command[],
  overrides: ShortcutOverrides,
  platform: KeyboardPlatform,
  command: Command,
  change: KeyBinding | null | 'default',
): KeyPlan {
  const before = effectiveKeys(commands, overrides, platform).keys;
  const current = shortcutOn(before.get(command.id), platform);
  const wanted: Shortcut | undefined =
    change === 'default'
      ? shortcutOn(command.shortcut, platform)
      : change === null
        ? undefined
        : stamp(change, platform);
  if (current && wanted && shortcutId(current) === shortcutId(wanted)) return { kind: 'same' };
  if (!current && !wanted) return { kind: 'same' };
  const applied = withBinding(overrides, command, change, platform);
  if (!wanted) return { kind: 'ok', overrides: applied };

  const id = shortcutId(wanted);
  const holds = (other: Command) => {
    if (other.id === command.id) return false;
    const theirs = shortcutOn(before.get(other.id), platform);
    return theirs !== undefined && shortcutId(theirs) === id;
  };
  // A holder in this command's own context is the real clash; one in the other context only
  // shadows, so it is looked for second whatever the registration order.
  const holder =
    commands.find((other) => holds(other) && other.context === command.context) ??
    commands.find(holds);
  if (!holder) return { kind: 'ok', overrides: applied };
  if (holder.context !== command.context) {
    // The editing binding wins while editing; the global one is untouched.
    const over = command.context === 'editing';
    return {
      kind: 'ok',
      overrides: applied,
      shadow: { kind: over ? 'over' : 'under', other: holder },
    };
  }
  if (!isRebindable(holder)) return { kind: 'refused', other: holder };
  const otherGets = current;
  const swapped = withBinding(applied, holder, otherGets ? toBinding(otherGets) : null, platform);
  return { kind: 'conflict', other: holder, overrides: swapped, ...(otherGets && { otherGets }) };
}

/** Conflicts of the commands under these overrides; empty for any map the recorder wrote. */
export function conflictsUnder(
  commands: readonly Command[],
  overrides: ShortcutOverrides,
  platform: KeyboardPlatform,
) {
  const { keys } = effectiveKeys(commands, overrides, platform);
  return findConflicts(commands, (command) => keys.get(command.id));
}
