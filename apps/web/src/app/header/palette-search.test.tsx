import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { PaletteSearch } from './palette-search';
import { renderHeader, spyOnCommand } from './test/render-header';

describe('PaletteSearch', () => {
  it('runs app.commandPalette on a click and opens the palette', async () => {
    const { registry, services } = renderHeader(<PaletteSearch />);
    const run = spyOnCommand(registry, 'app.commandPalette');
    await userEvent.click(screen.getByRole('button', { name: 'Search commands' }));
    expect(run).toHaveBeenCalledOnce();
    expect(services.ui.getState().paletteOpen).toBe(true);
  });

  it('is a dialog opener with its shortcut, and does not take focus on a click', () => {
    renderHeader(<PaletteSearch />);
    const button = screen.getByRole('button', { name: 'Search commands' });
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+K');
    expect(fireEvent.mouseDown(button)).toBe(false);
  });

  it('shows the tooltip with the key', async () => {
    renderHeader(<PaletteSearch />);
    await userEvent.hover(screen.getByRole('button', { name: 'Search commands' }));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Search commands (⌘K)');
  });
});
