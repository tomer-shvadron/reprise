import { write } from '@reprise/formats';
import { setMasterBar } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { must } from '@/features/editor/test/must';

import { createAppRegistry } from './app-registry';
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

describe('the palette with the real commands', () => {
  it('runs Bar properties, not Undo, after a Bar properties edit', async () => {
    const services = createTestServices();
    const built = score().track('guitar');
    built.bar();
    await services.document
      .getState()
      .openBytes('p.reprise', (await write(built.build(), 'reprise')).bytes);
    services.editing.getState().setEditing(true);
    const masterBar = must(services.document.getState().score?.masterBars[0]);
    services.document
      .getState()
      .apply(setMasterBar({ masterBarId: masterBar.id }, { repeat: { start: true, endCount: 0 } }));
    expect(services.document.getState().historyLabels.undo).toHaveLength(1);
    const registry = createAppRegistry(services);
    services.ui.getState().setPaletteOpen(true);
    render(<CommandPalette registry={registry} ui={services.ui} keyboard="other" />);
    const input = await screen.findByPlaceholderText('Type a command…');
    // The step's label is in the Undo title but not in what the palette searches.
    expect(screen.getByText('Undo Bar properties')).toBeTruthy();
    await userEvent.type(input, 'Bar properties');
    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toMatch(/^Bar properties/);
    expect(options.some((text) => text.startsWith('Undo'))).toBe(false);
    await userEvent.keyboard('{Enter}');
    expect(services.document.getState().historyLabels.undo).toHaveLength(1);
    expect(services.document.getState().historyLabels.redo).toHaveLength(0);
  });
});
