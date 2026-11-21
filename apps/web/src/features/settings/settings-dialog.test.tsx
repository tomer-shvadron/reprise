import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { installViewDefaults } from '@/app/install-view-defaults';
import { SETTINGS_SECTIONS } from '@/app/settings-sections';
import { AppServicesProvider } from '@/app/services-context';
import { CommandSourceContext } from '@/app/use-command';
import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';
import { TooltipProvider } from '@/components/ui/tooltip';
import {
  COUNT_IN_SETTING,
  DEFAULT_NOTATION_STRINGS_SETTING,
  DEFAULT_NOTATION_VOCALS_SETTING,
  DEFAULT_VIEW_MODE_SETTING,
  DEFAULT_ZOOM_SETTING,
  FOLLOW_PLAYHEAD_SETTING,
  METRONOME_VOLUME_SETTING,
  THEME_SETTING,
} from '@/state/app-settings';
import { createTestServices } from '@/test/services';
import { REGISTERED, SAMPLES } from '@/test/setting-samples';

import { SettingsDialog } from './settings-dialog';

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
});

async function setup() {
  const services = createTestServices();
  await services.settings.whenHydrated();
  const registry = createAppRegistry(services, 'mac');
  stop = installShortcutDispatcher(window, registry, 'mac');
  render(
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <button type="button">Behind</button>
        <CommandSourceContext value={{ registry, keyboard: 'mac' }}>
          <SettingsDialog sections={SETTINGS_SECTIONS} />
        </CommandSourceContext>
      </TooltipProvider>
    </AppServicesProvider>,
  );
  return { services, registry };
}

const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent);
const openSettings = (services: Awaited<ReturnType<typeof setup>>['services'], id?: string) => {
  act(() => {
    services.ui.getState().openSettings(id);
  });
};

describe('the settings dialog', () => {
  it('is opened by the app.settings command and lists the sections in order', async () => {
    const { services, registry } = await setup();
    expect(screen.queryByRole('dialog')).toBeNull();

    act(() => {
      void registry.get('app.settings')?.run();
    });

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(tabNames()).toEqual(['Appearance', 'Score', 'Playback and practice', 'Keyboard']);
    expect(services.ui.getState().settings.open).toBe(true);
  });

  it('moves between sections with the arrow keys', async () => {
    const { services } = await setup();
    openSettings(services);
    const user = userEvent.setup();

    screen.getByRole('tab', { name: 'Appearance' }).focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('tab', { name: 'Score', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Page' })).toBeInTheDocument();
  });

  it('opens at the section asked for, and at the first for an unknown id', async () => {
    const { services } = await setup();
    openSettings(services, 'playback');
    expect(
      screen.getByRole('tab', { name: 'Playback and practice', selected: true }),
    ).toBeVisible();

    act(() => {
      services.ui.getState().closeSettings();
    });
    openSettings(services, 'nonsense');
    expect(screen.getByRole('tab', { name: 'Appearance', selected: true })).toBeVisible();
  });

  it('writes each control to its setting', async () => {
    const { services } = await setup();
    const { settings } = services;
    openSettings(services);
    const user = userEvent.setup();

    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(settings.get(THEME_SETTING)).toBe('dark');
    // A second click on the pressed choice keeps it.
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(settings.get(THEME_SETTING)).toBe('dark');

    await user.click(screen.getByRole('tab', { name: 'Score' }));
    await user.click(screen.getByRole('radio', { name: 'Continuous' }));
    expect(settings.get(DEFAULT_VIEW_MODE_SETTING)).toBe('continuous');
    const zoom = screen.getByRole('slider', { name: 'Default zoom' });
    zoom.focus();
    await user.keyboard('{ArrowRight}');
    expect(settings.get(DEFAULT_ZOOM_SETTING)).toBeCloseTo(1.1, 5);
    expect(zoom).toHaveAttribute('aria-valuetext', '110%');
    const strings = screen.getByRole('radiogroup', { name: 'Notation for string instruments' });
    await user.click(within(strings).getByRole('radio', { name: 'Tab and standard notation' }));
    expect(settings.get(DEFAULT_NOTATION_STRINGS_SETTING)).toBe('both');
    const vocals = screen.getByRole('radiogroup', { name: 'Notation for vocals' });
    await user.click(within(vocals).getByRole('radio', { name: 'Standard notation' }));
    expect(settings.get(DEFAULT_NOTATION_VOCALS_SETTING)).toBe('standard');

    await user.click(screen.getByRole('tab', { name: 'Playback and practice' }));
    await user.click(screen.getByRole('switch', { name: 'Count-in' }));
    expect(settings.get(COUNT_IN_SETTING)).toBe(true);
    await user.click(screen.getByRole('switch', { name: 'Follow the playhead' }));
    expect(settings.get(FOLLOW_PLAYHEAD_SETTING)).toBe(false);
    screen.getByRole('slider', { name: 'Metronome volume' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(settings.get(METRONOME_VOLUME_SETTING)).toBeCloseTo(0.65, 5);
  });

  it('restores the notation defaults with the Score section', async () => {
    const { services } = await setup();
    const { settings } = services;
    settings.set(DEFAULT_NOTATION_STRINGS_SETTING, 'both');
    settings.set(DEFAULT_NOTATION_VOCALS_SETTING, 'standard');
    openSettings(services);
    const user = userEvent.setup();

    await user.click(screen.getByRole('tab', { name: 'Score' }));
    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));

    expect(settings.get(DEFAULT_NOTATION_STRINGS_SETTING)).toBe('tab');
    expect(settings.get(DEFAULT_NOTATION_VOCALS_SETTING)).toBe('tab');
  });

  it('restores the defaults of the section on screen only', async () => {
    const { services } = await setup();
    const { settings } = services;
    settings.set(THEME_SETTING, 'dark');
    settings.set(COUNT_IN_SETTING, true);
    openSettings(services);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Restore defaults' }));

    expect(settings.get(THEME_SETTING)).toBe('system');
    expect(settings.get(COUNT_IN_SETTING)).toBe(true);
  });

  it('closes on Escape and gives focus back', async () => {
    const { services } = await setup();
    const behind = screen.getByRole('button', { name: 'Behind' });
    behind.focus();
    openSettings(services);
    const user = userEvent.setup();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.ui.getState().settings.open).toBe(false);
    // The dialog restores focus in onCloseAutoFocus, which Radix fires on the next task.
    await waitFor(() => {
      expect(behind).toHaveFocus();
    });
  });

  it('blocks shortcuts: Cmd+, and Space inside it run nothing', async () => {
    const { services, registry } = await setup();
    openSettings(services);
    const spyOn = (id: string) => {
      const command = registry.get(id);
      if (!command) throw new Error(`no command ${id}`);
      return vi.spyOn(command, 'run');
    };
    const run = spyOn('app.settings');
    const toggle = spyOn('transport.playPause');

    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: 'Appearance' }), {
      key: ',',
      metaKey: true,
    });
    // A bare Space on a non-control: a tab would keep it for itself whether or not a dialog is open.
    fireEvent.keyDown(within(dialog).getByRole('heading', { name: 'Appearance' }), { key: ' ' });

    expect(run).not.toHaveBeenCalled();
    expect(toggle).not.toHaveBeenCalled();

    // The same Space plays once the dialog is gone, so the assertion above is the dialog's doing.
    act(() => {
      services.ui.getState().closeSettings();
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(toggle).toHaveBeenCalledOnce();
  });

  // Over every registered section, so a later section that forgets a handle in its `settings`
  // list (which Restore defaults would then leave alone) fails here with no test of its own.
  describe.each(SETTINGS_SECTIONS.map((section) => [section.id, section] as const))(
    'the %s section',
    (_id, section) => {
      const sampleOf = (key: string) => {
        if (!(key in SAMPLES)) throw new Error(`add a sample for ${key}`);
        return SAMPLES[key];
      };

      it('lists exactly the settings its controls show', async () => {
        const { services } = await setup();
        openSettings(services, section.id);
        const panel = screen.getByRole('tabpanel');
        const baseline = panel.innerHTML;
        const shown: string[] = [];
        for (const def of REGISTERED) {
          act(() => {
            services.settings.set(def, sampleOf(def.key));
          });
          if (panel.innerHTML !== baseline) shown.push(def.key);
          act(() => {
            services.settings.reset([def]);
          });
        }
        expect(shown.sort()).toEqual(section.settings.map((def) => def.key).sort());
      });

      it('restores its own settings and the current view, and no other', async () => {
        const { services } = await setup();
        installViewDefaults(services);
        for (const def of REGISTERED) services.settings.set(def, sampleOf(def.key));
        openSettings(services, section.id);
        const user = userEvent.setup();

        await user.click(screen.getByRole('button', { name: 'Restore defaults' }));

        const own = new Set(section.settings.map((def) => def.key));
        for (const def of REGISTERED) {
          expect(services.settings.get(def), def.key).toEqual(
            own.has(def.key) ? def.default : sampleOf(def.key),
          );
        }
        if (section.id === 'score') {
          expect(services.ui.getState().view.mode).toBe('paged');
          expect(services.ui.getState().zoom).toBe(1);
        }
      });
    },
  );
});
