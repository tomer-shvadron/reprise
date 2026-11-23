import { describe, expect, it, vi } from 'vitest';

import { CommandRegistry, contextLabel, type Command } from './command-registry';
import type { Shortcut } from './keyboard';
import { dispatchShortcut } from './shortcut-dispatcher';

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

  it('finds two commands overridden onto one key, per context and platform', () => {
    const keys: Record<string, Shortcut> = {};
    const registry = new CommandRegistry(
      () => false,
      (c) => keys[c.id] ?? c.shortcut,
    );
    registry.register(command({ id: 'a', shortcut: { key: 'a', mod: true } }));
    registry.register(command({ id: 'b', shortcut: { key: 'b', mod: true } }));
    registry.register(command({ id: 'c', shortcut: { key: 'a', mod: true }, context: 'editing' }));
    expect(registry.conflicts()).toEqual([]);
    keys['b'] = { key: 'a', mod: true };
    expect(registry.conflicts()).toEqual([
      { key: 'mod+a', context: undefined, first: 'a', second: 'b' },
    ]);
    // The same key in another context, or on the other platform only, is no collision.
    keys['b'] = { key: 'a', mod: true, only: 'mac' };
    expect(registry.conflicts()).toHaveLength(1);
    keys['a'] = { key: 'a', mod: true, only: 'other' };
    expect(registry.conflicts()).toEqual([]);
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

  it('lists the available commands and finds the context-free ones an active context shadows', () => {
    let editing = false;
    const registry = new CommandRegistry(() => editing);
    const seek = command({ id: 'seek', shortcut: { key: 'ArrowLeft' } });
    const move = command({ id: 'move', shortcut: { key: 'ArrowLeft' }, context: 'editing' });
    const other = command({ id: 'other', shortcut: { key: 'ArrowRight' } });
    for (const c of [seek, move, other]) registry.register(c);

    expect(registry.available()).toEqual([seek, other]);
    expect(registry.isShadowed(seek)).toBe(false);

    editing = true;
    expect(registry.available()).toEqual([seek, move, other]);
    expect(registry.isShadowed(seek)).toBe(true);
    expect(registry.isShadowed(other)).toBe(false);
    expect(registry.isShadowed(move)).toBe(false);
  });

  it('ranks the standard staff above editing, and editing above a context-free key', () => {
    let editing = false;
    let staff = false;
    const registry = new CommandRegistry((context) => editing && (context === 'editing' || staff));
    const seek = command({ id: 'seek', shortcut: { key: 'a' } });
    const chord = command({ id: 'chord', shortcut: { key: 'a' }, context: 'editing' });
    const note = command({ id: 'note', shortcut: { key: 'a' }, context: 'standardStaff' });
    for (const c of [seek, chord, note]) registry.register(c);

    editing = true;
    expect(registry.available()).toEqual([seek, chord]);
    expect(registry.isShadowed(seek)).toBe(true);
    expect(registry.isShadowed(chord)).toBe(false);

    staff = true;
    expect(registry.available()).toEqual([seek, chord, note]);
    expect(registry.isShadowed(seek)).toBe(true);
    expect(registry.isShadowed(chord)).toBe(true);
    expect(registry.isShadowed(note)).toBe(false);
  });

  it('allows one key in different contexts, and labels each context', () => {
    const registry = new CommandRegistry();
    registry.register(command({ id: 'a', shortcut: { key: 'a' }, context: 'editing' }));
    registry.register(command({ id: 'b', shortcut: { key: 'a' }, context: 'standardStaff' }));
    expect(() =>
      registry.register(command({ id: 'c', shortcut: { key: 'a' }, context: 'standardStaff' })),
    ).toThrow('in the standardStaff context');
    expect([undefined, 'editing', 'standardStaff'].map((c) => contextLabel(c as never))).toEqual([
      'Global',
      'Editing',
      'Standard staff',
    ]);
  });

  it('leaves a command out of available() while it reports itself not enabled', () => {
    let on = false;
    const registry = new CommandRegistry();
    const gated = command({ id: 'gated', enabled: () => on, shortcut: { key: 'g' } });
    registry.register(gated);
    expect(registry.available()).toEqual([]);
    expect(registry.list()).toEqual([gated]);
    on = true;
    expect(registry.available()).toEqual([gated]);
  });

  it('does not run an unavailable command from its shortcut', () => {
    const run = vi.fn();
    const registry = new CommandRegistry();
    registry.register(command({ enabled: () => false, shortcut: { key: 'g' }, run }));
    dispatchShortcut(new KeyboardEvent('keydown', { key: 'g' }), registry, 'other');
    expect(run).not.toHaveBeenCalled();
  });
});
