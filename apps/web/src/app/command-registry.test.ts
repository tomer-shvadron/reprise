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

  it('binds the same key once per context', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'seek', shortcut: { key: 'ArrowLeft' } }));
    registry.register(command({ id: 'move', shortcut: { key: 'ArrowLeft' }, context: 'editing' }));

    expect(() =>
      registry.register(
        command({ id: 'move2', shortcut: { key: 'ArrowLeft' }, context: 'editing' }),
      ),
    ).toThrow('Shortcut "arrowleft" in the editing context of "move2" is already bound to "move"');
    expect(() =>
      registry.register(command({ id: 'seek2', shortcut: { key: 'ArrowLeft' } })),
    ).toThrow('Shortcut "arrowleft" of "seek2" is already bound to "seek"');
  });

  it('reports whether a context is active', () => {
    let editing = false;
    const registry = new CommandRegistry(() => editing);
    expect(registry.isActive('editing')).toBe(false);
    editing = true;
    expect(registry.isActive('editing')).toBe(true);
    expect(new CommandRegistry().isActive('editing')).toBe(false);
  });

  it('unregistering a context binding keeps the context-free one', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'seek', shortcut: { key: 'Home' } }));
    const off = registry.register(
      command({ id: 'move', shortcut: { key: 'Home' }, context: 'editing' }),
    );
    off();
    expect(() =>
      registry.register(command({ id: 'move', shortcut: { key: 'Home' }, context: 'editing' })),
    ).not.toThrow();
    expect(() => registry.register(command({ id: 'seek2', shortcut: { key: 'Home' } }))).toThrow(
      'already bound',
    );
  });
});
