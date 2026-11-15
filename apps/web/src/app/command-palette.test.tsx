import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { CommandPalette } from './command-palette';
import { CommandRegistry } from './command-registry';
import { formatShortcut } from './keyboard';

const KEY = formatShortcut({ key: 'ArrowLeft' }, 'other');

function setup(editing: boolean) {
  const { ui } = createTestServices();
  ui.getState().setPaletteOpen(true);
  const registry = new CommandRegistry(() => editing);
  registry.register({
    id: 'transport.back',
    title: 'Back',
    shortcut: { key: 'ArrowLeft' },
    run: () => undefined,
  });
  registry.register({
    id: 'editor.left',
    title: 'Cursor left',
    shortcut: { key: 'ArrowLeft' },
    context: 'editing',
    run: () => undefined,
  });
  render(<CommandPalette registry={registry} ui={ui} keyboard="other" />);
}

describe('command palette contexts', () => {
  it('hides editing commands in play mode and shows the transport key', () => {
    setup(false);
    expect(screen.getByText('Back')).toBeTruthy();
    expect(screen.queryByText('Cursor left')).toBeNull();
    expect(screen.getAllByText(KEY)).toHaveLength(1);
  });

  it('lists editing commands while editing and shows each key once, on the one that fires', () => {
    setup(true);
    expect(screen.getByText('Cursor left')).toBeTruthy();
    const keys = screen.getAllByText(KEY);
    expect(keys).toHaveLength(1);
    expect(screen.getByText('Cursor left').parentElement?.contains(keys[0] ?? null)).toBe(true);
  });
});
