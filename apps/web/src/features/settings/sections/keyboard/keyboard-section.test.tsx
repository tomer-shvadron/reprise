import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { SHORTCUT_OVERRIDES_SETTING } from '@/app/keymap';
import { SETTINGS_SECTIONS } from '@/app/settings-sections';
import { AppServicesProvider } from '@/app/services-context';
import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';
import { ShortcutSheet } from '@/app/shortcut-sheet';
import type { ReactNode } from 'react';

import type { CommandRegistry } from '@/app/command-registry';
import { CommandSourceContext, useCommand, useCommandSource } from '@/app/use-command';
import { TooltipProvider } from '@/components/ui/tooltip';
import { createTestServices } from '@/test/services';

import { SettingsDialog } from '../../settings-dialog';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

/** What `App` does: a source that follows the overrides. */
function Source({
  registry,
  settings,
  children,
}: {
  registry: CommandRegistry;
  settings: ReturnType<typeof createTestServices>['settings'];
  children: ReactNode;
}) {
  const source = useCommandSource(registry, 'mac', settings);
  return <CommandSourceContext value={source}>{children}</CommandSourceContext>;
}

/** A consumer of `useCommand`, as the header and the transport are. */
function Tip() {
  const { keys } = useCommand('view.toggleViewMode');
  return <output aria-label="tip">{keys}</output>;
}

async function setup() {
  const services = createTestServices();
  await services.settings.whenHydrated();
  const registry = createAppRegistry(services, 'mac');
  stop = installShortcutDispatcher(window, registry, 'mac');
  render(
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <Source registry={registry} settings={services.settings}>
          <Tip />
          <SettingsDialog sections={SETTINGS_SECTIONS} />
          <ShortcutSheet
            registry={registry}
            ui={services.ui}
            settings={services.settings}
            keyboard="mac"
          />
        </Source>
      </TooltipProvider>
    </AppServicesProvider>,
  );
  act(() => {
    services.ui.getState().openSettings('keyboard');
  });
  return { services, registry, user: userEvent.setup() };
}

const VIEW = 'Toggle page and continuous view';
const keyButton = (title: string, now: string) =>
  screen.getByRole('button', { name: `Change key for ${title}, now ${now}` });
const overrides = (services: Awaited<ReturnType<typeof setup>>['services']) =>
  services.settings.get(SHORTCUT_OVERRIDES_SETTING);

describe('the Keyboard section', () => {
  it('lists the commands with their keys, and the fixed ones without buttons', async () => {
    await setup();
    expect(keyButton(VIEW, 'F4')).toHaveTextContent('F4');
    expect(keyButton('Save', 'Command+S')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change key for Copy/ })).toBeNull();
    expect(screen.getAllByTitle('Set by the system').length).toBeGreaterThan(0);
  });

  it('filters by title and by key', async () => {
    const { user } = await setup();
    await user.type(screen.getByRole('textbox', { name: 'Filter commands or keys' }), 'f8');
    expect(screen.getByRole('button', { name: /Change key for Toggle mixer/ })).toBeVisible();
    expect(screen.queryByRole('button', { name: /Change key for Save,/ })).toBeNull();
  });

  it('records a key, writes the setting, announces it and gives focus back', async () => {
    const { services, user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    const recorder = screen.getByRole('application', { name: `Press the new key for ${VIEW}` });
    expect(recorder).toHaveFocus();

    await user.keyboard('{F5}');

    expect(overrides(services)).toMatchObject({ 'view.toggleViewMode': { key: 'F5' } });
    expect(Object.keys(overrides(services))).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(`${VIEW} is now F5.`);
    await waitFor(() => {
      expect(keyButton(VIEW, 'F5')).toHaveFocus();
    });
    // Everything that shows keys follows, with no remount.
    expect(screen.getByLabelText('tip')).toHaveTextContent('F5');
  });

  it('runs the command on the new key and not on the old one', async () => {
    const { services, registry, user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    await user.keyboard('{F5}');
    act(() => {
      services.ui.getState().closeSettings();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const before = services.ui.getState().view.mode;

    await user.keyboard('{F4}');
    expect(services.ui.getState().view.mode).toBe(before);
    await user.keyboard('{F5}');
    expect(services.ui.getState().view.mode).not.toBe(before);
    expect(registry.conflicts()).toEqual([]);
  });

  it('cancels on Escape without closing the dialog', async () => {
    const { services, user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    await user.keyboard('{Escape}');

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('application')).toBeNull();
    expect(overrides(services)).toEqual({});
    expect(screen.getByRole('status')).toHaveTextContent('Cancelled.');
    await waitFor(() => {
      expect(keyButton(VIEW, 'F4')).toHaveFocus();
    });
  });

  it('cancels on Tab and never traps focus', async () => {
    const { user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    await user.keyboard('{Tab}');
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('refuses a reserved key with a reason and keeps recording', async () => {
    const { services, user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    await user.keyboard('{Meta>}q{/Meta}');
    expect(screen.getByRole('status')).toHaveTextContent('The system keeps that key');
    expect(screen.getByRole('application')).toBeInTheDocument();
    expect(overrides(services)).toEqual({});
  });

  it('offers a swap for a key another command holds, and writes both', async () => {
    const { services, user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    await user.keyboard('{F8}');

    const group = screen.getByRole('group');
    expect(group).toHaveTextContent("F8 is Toggle mixer's key");
    expect(screen.getByRole('button', { name: 'Swap' })).toHaveFocus();
    expect(overrides(services)).toEqual({});

    await user.click(screen.getByRole('button', { name: 'Swap' }));
    expect(overrides(services)).toMatchObject({
      'view.toggleViewMode': { key: 'F8' },
      'view.togglePanel': { key: 'F4' },
    });
  });

  it('writes nothing when the swap is cancelled', async () => {
    const { services, user } = await setup();
    await user.click(keyButton(VIEW, 'F4'));
    await user.keyboard('{F8}');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(overrides(services)).toEqual({});
    expect(screen.queryByRole('group')).toBeNull();
  });

  it('refuses the key of a command that cannot be changed', async () => {
    const { services, user } = await setup();
    // "3" types fret 3 while editing; the same context needs a command that is editing too.
    await user.click(
      screen.getByRole('button', {
        name: /Change key for Toggle insert mode|Add key for Toggle insert mode/,
      }),
    );
    await user.keyboard('3');
    expect(screen.getByRole('status')).toHaveTextContent("3 is Type fret digit's key");
    expect(overrides(services)).toEqual({});
  });

  it('clears a key, and resets it', async () => {
    const { services, user } = await setup();
    await user.click(screen.getByRole('button', { name: `Remove F4 from ${VIEW}` }));
    expect(overrides(services)).toEqual({ 'view.toggleViewMode': null });
    expect(screen.getByRole('button', { name: `Add key for ${VIEW}` })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: `Reset ${VIEW} to F4` }));
    expect(overrides(services)).toEqual({});
  });

  it('restores every default with the footer button', async () => {
    const { services, user } = await setup();
    services.settings.set(SHORTCUT_OVERRIDES_SETTING, { 'view.toggleViewMode': { key: 'F5' } });
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));
    expect(overrides(services)).toEqual({});
  });

  it('shows the new key in the cheat sheet', async () => {
    const { services } = await setup();
    act(() => {
      services.settings.set(SHORTCUT_OVERRIDES_SETTING, { 'view.toggleViewMode': { key: 'F5' } });
      services.ui.getState().closeSettings();
      services.ui.getState().setShortcutsOpen(true);
    });
    const row = await screen.findByText(VIEW);
    expect(row.closest('li')).toHaveTextContent('F5');
  });
});
