import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { TOOLTIP_DELAY_MS } from '@/components/ui/tooltip';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { CommandTooltip } from './command-tooltip';
import { SHORTCUT_OVERRIDES_SETTING } from './keymap';
import { CommandSourceContext, useCommandSource, type RegisteredCommandId } from './use-command';
import type { KeyboardPlatform } from './keyboard';

function Fixture({
  keyboard,
  services,
  command,
  whenUnbound,
  openOnFocus,
  disabled,
  reason,
}: {
  keyboard: KeyboardPlatform;
  services: ReturnType<typeof createTestServices>;
  command: RegisteredCommandId;
  whenUnbound?: 'label' | 'none';
  openOnFocus?: boolean;
  disabled?: boolean;
  reason?: string;
}) {
  const [registry] = useState(() => createAppRegistry(services, keyboard));
  const source = useCommandSource(registry, keyboard, services.settings, services.editing);
  return (
    <CommandSourceContext value={source}>
      <CommandTooltip
        command={command}
        label="Thing"
        {...(whenUnbound && { whenUnbound })}
        {...(openOnFocus !== undefined && { openOnFocus })}
        {...(reason && { reason })}
      >
        <button disabled={disabled}>Go</button>
      </CommandTooltip>
    </CommandSourceContext>
  );
}

const render = (props: Omit<Parameters<typeof Fixture>[0], 'services'>) => {
  const services = createTestServices();
  renderWithServices(<Fixture {...props} services={services} />, services);
  return services;
};

describe('CommandTooltip', () => {
  it('opens at once on keyboard focus with one cap per key', async () => {
    render({ keyboard: 'mac', command: 'file.save' });
    await userEvent.setup().tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Thing, Command+S');
    expect(tip.textContent).not.toMatch(/[⌘⌥⇧↩]/);
    const caps = [...document.querySelectorAll('[data-slot=tooltip-content] [data-slot=kbd]')];
    expect(caps.map((cap) => cap.textContent)).toEqual(['⌘', 'S']);
  });

  it('uses Ctrl off macOS and joins two bindings with "or"', async () => {
    render({ keyboard: 'other', command: 'edit.redo' });
    await userEvent.setup().tab();
    await screen.findByRole('tooltip');
    const content = document.querySelector('[data-slot=tooltip-content]');
    const caps = [...(content?.querySelectorAll('[data-slot=kbd]') ?? [])];
    expect(caps.map((cap) => cap.textContent)).toEqual(['Ctrl', 'Shift', 'Z', 'Ctrl', 'Y']);
    expect(content).toHaveTextContent('or');
    expect(screen.getByRole('button')).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+Z Control+Y',
    );
  });

  it('opens on hover only after the delay', async () => {
    render({ keyboard: 'mac', command: 'file.save' });
    const user = userEvent.setup();
    await user.hover(screen.getByRole('button'));
    expect(screen.queryByRole('tooltip')).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TOOLTIP_DELAY_MS + 100));
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('follows a rebind in the open tooltip and in aria-keyshortcuts', async () => {
    const services = render({ keyboard: 'mac', command: 'file.save' });
    await userEvent.setup().tab();
    await screen.findByRole('tooltip');
    act(() => {
      services.settings.set(SHORTCUT_OVERRIDES_SETTING, { 'file.save': { key: 'k', alt: true } });
    });
    expect(screen.getByRole('button')).toHaveAttribute('aria-keyshortcuts', 'Alt+K');
    const caps = [...document.querySelectorAll('[data-slot=tooltip-content] [data-slot=kbd]')];
    expect(caps.map((cap) => cap.textContent)).toEqual(['⌥', 'K']);
  });

  it('keeps a label-only tooltip when unbound, or none with whenUnbound="none"', async () => {
    // `app.shortcutsAlt`-free pick: a command with no default key.
    render({ keyboard: 'mac', command: 'view.toggleSidebar' });
    await userEvent.setup().tab();
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Thing');
    expect(document.querySelector('[data-slot=kbd]')).toBeNull();
  });

  it('shows nothing when unbound and asked for none', async () => {
    render({ keyboard: 'mac', command: 'view.toggleSidebar', whenUnbound: 'none' });
    await userEvent.setup().tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does not open on focus for a text field, but does on hover', async () => {
    render({ keyboard: 'mac', command: 'file.save', openOnFocus: false });
    const user = userEvent.setup();
    await user.tab();
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.hover(screen.getByRole('button'));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TOOLTIP_DELAY_MS + 100));
    });
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('explains a disabled control instead of showing keys', async () => {
    render({ keyboard: 'mac', command: 'file.save', disabled: true, reason: 'Nothing to save' });
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+S');
    expect(button).toHaveAccessibleDescription('Nothing to save');
    await userEvent.setup().hover(button.parentElement as HTMLElement);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, TOOLTIP_DELAY_MS + 100));
    });
    const tip = screen.getByRole('tooltip');
    expect(within(tip).queryByText('S')).toBeNull();
    expect(tip).toHaveTextContent('Thing: Nothing to save');
  });
});
