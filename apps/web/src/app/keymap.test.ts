import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { CommandRegistry, type Command } from './command-registry';
import {
  conflictsUnder,
  effectiveKeys,
  KEY_BINDING_SCHEMA,
  planChange,
  SHORTCUT_OVERRIDES_SETTING,
  withBinding,
  type ShortcutOverrides,
} from './keymap';

const cmd = (id: string, extra: Partial<Command> = {}): Command => ({
  id,
  title: id,
  run: () => undefined,
  ...extra,
});

const COMMANDS = [
  cmd('a.save', { shortcut: { key: 's', mod: true } }),
  cmd('a.open', { shortcut: { key: 'o', mod: true } }),
  cmd('a.bare'),
  cmd('e.insert', { shortcut: { key: 's', mod: true }, context: 'editing' }),
  cmd('a.copy', { shortcut: { key: 'c', mod: true }, native: true }),
  cmd('a.back', { shortcut: { key: 'Escape' } }),
  cmd('e.fret', { shortcut: { key: '3' }, context: 'editing', rebindable: false }),
  cmd('w.only', { shortcut: { key: 'y', mod: true, only: 'other' } }),
];

describe('the override setting', () => {
  const parse = (value: unknown) => SHORTCUT_OVERRIDES_SETTING.schema.parse(value);

  it('drops one bad entry and keeps the rest, unknown ids included', () => {
    const parsed = parse({
      'a.save': { key: 'F5' },
      'a.open': { key: 'Escape' },
      'a.bare': { key: 'x', extra: true },
      'gone.command': { key: 'F6', shift: true },
      'a.cleared': null,
    });
    expect(parsed['a.save']).toEqual({ key: 'F5' });
    expect(parsed['a.open']).toBeUndefined();
    expect(parsed['a.bare']).toBeUndefined();
    expect(parsed['gone.command']).toEqual({ key: 'F6', shift: true });
    expect(parsed['a.cleared']).toBeNull();
  });

  it('accepts one printable character, Space and the named keys, and nothing else', () => {
    for (const key of ['a', 'ö', '?', ' ', 'F24', 'ArrowUp', 'Delete']) {
      expect(KEY_BINDING_SCHEMA.safeParse({ key }).success).toBe(true);
    }
    for (const key of ['', 'ab', 'F25', 'Tab', 'Escape', '\t', '\u0007']) {
      expect(KEY_BINDING_SCHEMA.safeParse({ key }).success).toBe(false);
    }
  });
});

describe('effectiveKeys', () => {
  it('stamps an override with the platform and leaves the default of another command', () => {
    const { keys } = effectiveKeys(COMMANDS, { 'a.bare': { key: 'F5', code: 'F5' } }, 'mac');
    expect(keys.get('a.bare')).toEqual({ key: 'F5', only: 'mac' });
    expect(keys.get('a.save')).toEqual({ key: 's', mod: true });
  });

  it('clears a command with null', () => {
    expect(effectiveKeys(COMMANDS, { 'a.save': null }, 'mac').keys.get('a.save')).toBeUndefined();
  });

  it('displaces a default an override claims in the same context, and keeps one in another context', () => {
    const { keys, displacedBy } = effectiveKeys(
      COMMANDS,
      { 'a.bare': { key: 's', mod: true } },
      'mac',
    );
    expect(keys.get('a.save')).toBeUndefined();
    expect(displacedBy.get('a.save')).toBe('a.bare');
    // The editing binding of the same key is another context.
    expect(keys.get('e.insert')).toEqual({ key: 's', mod: true });
  });

  it('gives an override that collides with an earlier override no key', () => {
    const { keys } = effectiveKeys(
      COMMANDS,
      { 'a.bare': { key: 'F5' }, 'a.save': { key: 'F5' } },
      'mac',
    );
    // Registration order decides: the earlier command keeps the key.
    expect(keys.get('a.save')).toEqual({ key: 'F5', only: 'mac' });
    expect(keys.get('a.bare')).toBeUndefined();
  });

  it('ignores the entries of commands that are not rebindable', () => {
    const { keys } = effectiveKeys(
      COMMANDS,
      { 'a.copy': null, 'a.back': { key: 'F9' }, 'e.fret': { key: 'F9' } },
      'mac',
    );
    expect(keys.get('a.copy')).toEqual({ key: 'c', mod: true });
    expect(keys.get('a.back')).toEqual({ key: 'Escape' });
    expect(keys.get('e.fret')).toEqual({ key: '3' });
  });

  it('passes a default of the other platform through, so a mac override cannot clash with it', () => {
    const overrides: ShortcutOverrides = { 'a.bare': { key: 'y', mod: true } };
    const { keys } = effectiveKeys(COMMANDS, overrides, 'mac');
    expect(keys.get('w.only')).toEqual({ key: 'y', mod: true, only: 'other' });
    expect(conflictsUnder(COMMANDS, overrides, 'mac')).toEqual([]);
  });
});

describe('withBinding', () => {
  const save = COMMANDS[0] as Command;
  const bare = COMMANDS[2] as Command;

  it('stores only real changes', () => {
    expect(withBinding({}, save, { key: 'S', mod: true }, 'mac')).toEqual({});
    expect(withBinding({}, save, { key: 'F5' }, 'mac')).toEqual({ 'a.save': { key: 'F5' } });
    expect(withBinding({ 'a.save': { key: 'F5' } }, save, 'default', 'mac')).toEqual({});
    expect(withBinding({}, bare, null, 'mac')).toEqual({});
    expect(withBinding({}, save, null, 'mac')).toEqual({ 'a.save': null });
  });
});

describe('planChange', () => {
  const find = (id: string) => COMMANDS.find((c) => c.id === id) as Command;

  it('is the same for the key it already has', () => {
    expect(planChange(COMMANDS, {}, 'mac', find('a.save'), { key: 's', mod: true }).kind).toBe(
      'same',
    );
  });

  it('offers a swap for a key another command holds, giving it the old key', () => {
    const plan = planChange(COMMANDS, {}, 'mac', find('a.save'), { key: 'o', mod: true });
    expect(plan.kind).toBe('conflict');
    if (plan.kind !== 'conflict') return;
    expect(plan.other.id).toBe('a.open');
    expect(plan.overrides).toEqual({
      'a.save': { key: 'o', mod: true },
      'a.open': { key: 's', mod: true },
    });
    expect(conflictsUnder(COMMANDS, plan.overrides, 'mac')).toEqual([]);
  });

  it('swaps in no key when the command had none', () => {
    const plan = planChange(COMMANDS, {}, 'mac', find('a.bare'), { key: 'o', mod: true });
    if (plan.kind !== 'conflict') throw new Error('expected a conflict');
    expect(plan.overrides['a.open']).toBeNull();
    expect(conflictsUnder(COMMANDS, plan.overrides, 'mac')).toEqual([]);
  });

  it('refuses a key a command that is not rebindable holds in the same context', () => {
    const plan = planChange(COMMANDS, {}, 'mac', find('e.insert'), { key: '3' });
    expect(plan.kind).toBe('refused');
  });

  it('lets a key through that another context holds, with a note', () => {
    const plan = planChange(COMMANDS, {}, 'mac', find('a.bare'), { key: '3' });
    expect(plan.kind).toBe('ok');
    if (plan.kind === 'ok') expect(plan.shadow?.other.id).toBe('e.fret');
  });

  it('resets onto a default that another override took, as a swap', () => {
    const taken: ShortcutOverrides = { 'a.bare': { key: 's', mod: true } };
    const plan = planChange(COMMANDS, taken, 'mac', find('a.save'), 'default');
    expect(plan.kind).toBe('conflict');
    if (plan.kind !== 'conflict') return;
    // The displaced command had no default: it ends with no key, and no entry is stored for that.
    expect(plan.overrides).toEqual({});
    expect(conflictsUnder(COMMANDS, plan.overrides, 'mac')).toEqual([]);
  });

  it('leaves the registry conflict-free after a seeded sequence of changes', () => {
    const keys = ['s', 'o', 'F5', 'F6', 'x'].map((key) => ({ key, mod: key.length === 1 }));
    let overrides: ShortcutOverrides = {};
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    for (let i = 0; i < 60; i += 1) {
      const command = find(['a.save', 'a.open', 'a.bare', 'e.insert'][next(4)] ?? 'a.save');
      const change = next(5) === 0 ? 'default' : (keys[next(keys.length)] ?? null);
      const plan = planChange(COMMANDS, overrides, 'mac', command, change);
      if (plan.kind === 'ok' || plan.kind === 'conflict') overrides = plan.overrides;
      expect(conflictsUnder(COMMANDS, overrides, 'mac')).toEqual([]);
    }
  });
});

describe('a key held in both contexts', () => {
  const both = [
    cmd('g.stop', { shortcut: { key: 'Enter' } }),
    cmd('e.insertBeat', { shortcut: { key: 'Enter' }, context: 'editing' }),
    cmd('e.previous', { shortcut: { key: 'F5' }, context: 'editing' }),
  ];
  const find = (id: string) => both.find((c) => c.id === id) as Command;

  it('offers a swap with the holder in the same context, whatever the registration order', () => {
    const plan = planChange(both, {}, 'other', find('e.previous'), { key: 'Enter' });
    expect(plan.kind).toBe('conflict');
    if (plan.kind !== 'conflict') return;
    expect(plan.other.id).toBe('e.insertBeat');
    expect(plan.overrides).toEqual({
      'e.previous': { key: 'Enter' },
      'e.insertBeat': { key: 'F5' },
    });
    expect(conflictsUnder(both, plan.overrides, 'other')).toEqual([]);
  });

  it('shadows the global command only when no same-context command holds the key', () => {
    const plan = planChange(both, {}, 'other', find('e.insertBeat'), { key: 'F5' });
    expect(plan.kind).toBe('conflict');
    const lone = [both[0] as Command, both[2] as Command];
    const shadow = planChange(lone, {}, 'other', lone[1] as Command, { key: 'Enter' });
    expect(shadow.kind === 'ok' && shadow.shadow?.other.id).toBe('g.stop');
  });
});

describe('fixed commands', () => {
  it('claim their keys before the overrides', () => {
    const { keys, displacedBy } = effectiveKeys(
      COMMANDS,
      { 'a.bare': { key: '3' }, 'e.insert': { key: '3' }, 'a.open': { key: 'c', mod: true } },
      'mac',
    );
    expect(keys.get('e.fret')).toEqual({ key: '3' });
    expect(keys.get('e.insert')).toBeUndefined();
    expect(displacedBy.get('e.insert')).toBe('e.fret');
    expect(keys.get('a.copy')).toEqual({ key: 'c', mod: true });
    expect(keys.get('a.open')).toBeUndefined();
    // Another context is not a clash.
    expect(keys.get('a.bare')).toEqual({ key: '3', only: 'mac' });
  });
});

describe('the app registry with overrides', () => {
  it('answers the overridden key, and does not throw at launch for stored colliding overrides', async () => {
    const services = createTestServices();
    await services.settings.whenHydrated();
    const registry = createAppRegistry(services, 'mac');
    const toggle = registry.get('view.toggleViewMode');
    if (!toggle) throw new Error('no command');
    expect(registry.shortcutOf(toggle)).toEqual({ key: 'F4' });

    services.settings.set(SHORTCUT_OVERRIDES_SETTING, { 'view.toggleViewMode': { key: 'F5' } });
    expect(registry.shortcutOf(toggle)).toEqual({ key: 'F5', only: 'mac' });
    expect(registry.conflicts()).toEqual([]);

    // Corrupt data: two commands on one key. The earlier one keeps it, and nothing throws.
    services.settings.set(SHORTCUT_OVERRIDES_SETTING, {
      'view.toggleViewMode': { key: 'F5' },
      'view.togglePanel': { key: 'F5' },
    });
    expect(registry.shortcutOf(toggle)).toBeUndefined();
    expect(registry.conflicts()).toEqual([]);
    expect(createAppRegistry(services, 'mac').conflicts()).toEqual([]);
  });

  it('bumps the registry version on register and unregister', () => {
    const registry = new CommandRegistry();
    const undo = registry.register(cmd('x', { shortcut: { key: 'F4' } }));
    expect(registry.version).toBe(1);
    undo();
    expect(registry.version).toBe(2);
  });
});
