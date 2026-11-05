import { describe, expect, it, vi } from 'vitest';

import { CommandRegistry, type Command } from './command-registry';

const command = (overrides: Partial<Command> = {}): Command => ({
  id: 'test.command',
  title: 'Test command',
  run: vi.fn(),
  ...overrides,
});

describe('CommandRegistry', () => {
  it('registers commands and looks them up by id', () => {
    const registry = new CommandRegistry();
    const open = command({ id: 'file.open', title: 'Open file' });
    const toggle = command({ id: 'view.toggleTheme', title: 'Toggle theme' });

    registry.register(open);
    registry.register(toggle);

    expect(registry.get('file.open')).toBe(open);
    expect(registry.get('missing')).toBeUndefined();
    expect(registry.list()).toEqual([open, toggle]);
  });

  it('rejects a duplicate id', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'file.open' }));

    expect(() => registry.register(command({ id: 'file.open' }))).toThrow(
      'Command "file.open" is already registered',
    );
  });

  it('rejects a shortcut that is already bound', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'a', shortcut: { key: 'O', mod: true } }));

    expect(() =>
      registry.register(command({ id: 'b', shortcut: { key: 'o', mod: true } })),
    ).toThrow('Shortcut "mod+o" of "b" is already bound to "a"');
    expect(() =>
      registry.register(command({ id: 'c', shortcut: { key: 'o', mod: true, shift: true } })),
    ).not.toThrow();
  });

  it('unregisters, freeing the id and the shortcut', () => {
    const registry = new CommandRegistry();
    const unregister = registry.register(command({ id: 'a', shortcut: { key: 'k', mod: true } }));

    unregister();

    expect(registry.get('a')).toBeUndefined();
    expect(() =>
      registry.register(command({ id: 'a', shortcut: { key: 'k', mod: true } })),
    ).not.toThrow();
  });
});
