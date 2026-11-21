import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';

import { ModeSwitch } from './mode-switch';
import { renderHeader, spyOnCommand } from './test/render-header';

const radio = (name: string) => screen.getByRole('radio', { name });

describe('ModeSwitch', () => {
  it('has Play checked, and Edit disabled with no score', () => {
    renderHeader(<ModeSwitch />);
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument();
    expect(radio('Play')).toBeChecked();
    expect(radio('Edit')).toBeDisabled();
  });

  it('has a Practice segment between Play and Edit, disabled with no score', () => {
    renderHeader(<ModeSwitch />);
    expect(screen.getAllByRole('radio').map((item) => item.textContent)).toEqual([
      'Play',
      'Practice',
      'Edit',
    ]);
    expect(radio('Practice')).toBeDisabled();
  });

  it('enters practice mode from the Practice segment, with F11 as its key', async () => {
    const { open, registry, services } = renderHeader(<ModeSwitch />);
    await open();
    expect(radio('Practice')).toHaveAttribute('aria-keyshortcuts', 'F11');
    const run = spyOnCommand(registry, 'view.practiceMode');
    await userEvent.click(radio('Practice'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(services.ui.getState().practiceMode.on).toBe(true);
    expect(radio('Practice')).toBeChecked();
  });

  it('switches through editor.toggleMode and ignores a click on the checked segment', async () => {
    const { registry, open, services } = renderHeader(<ModeSwitch />);
    await open();
    const run = spyOnCommand(registry, 'editor.toggleMode');
    await userEvent.click(radio('Edit'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(services.editing.getState().editing).toBe(true);
    expect(radio('Edit')).toBeChecked();
    await userEvent.click(radio('Edit'));
    expect(run).toHaveBeenCalledTimes(1);
    expect(radio('Edit')).toBeChecked();
    await userEvent.click(radio('Play'));
    expect(run).toHaveBeenCalledTimes(2);
    expect(radio('Play')).toBeChecked();
  });

  it('follows the editing store when something else toggles it', async () => {
    const { open, services } = renderHeader(<ModeSwitch />);
    await open();
    act(() => {
      services.editing.getState().setEditing(true);
    });
    expect(radio('Edit')).toBeChecked();
  });

  it('shows the key in the tooltip and aria-keyshortcuts', async () => {
    const { open } = renderHeader(<ModeSwitch />);
    await open();
    expect(radio('Edit')).toHaveAttribute('aria-keyshortcuts', 'Meta+E');
    await userEvent.hover(radio('Edit'));
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Edit mode, Command+E');
  });

  it('keeps its arrow keys and Space to itself', async () => {
    const { open, registry } = renderHeader(<ModeSwitch />);
    await open();
    const stop = installShortcutDispatcher(window, registry, 'mac');
    const next = spyOnCommand(registry, 'transport.nextBeat');
    const playPause = spyOnCommand(registry, 'transport.playPause');
    const user = userEvent.setup();
    radio('Play').focus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Practice')).toHaveFocus();
    expect(next).not.toHaveBeenCalled();
    await user.keyboard(' ');
    expect(playPause).not.toHaveBeenCalled();
    stop();
  });
});
