import { describe, expect, it } from 'vitest';

import { BOTTOM_DOCK_HEIGHT_SETTING, BOTTOM_DOCK_OPEN_SETTING } from '@/state/app-settings';
import { createUiStore } from '@/state/ui';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { installBottomDock } from './install-bottom-dock';

describe('installBottomDock', () => {
  it('shows the stored open state and height once they load', async () => {
    const backend = createMemorySettingsBackend([
      ['layout.bottomDockOpen', true],
      ['layout.bottomDockHeight', 320],
    ]);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    const stop = installBottomDock({ settings, ui });
    expect(ui.getState().bottomPanel.open).toBe(false);
    await settings.whenHydrated();
    expect(ui.getState().bottomPanel.open).toBe(true);
    expect(ui.getState().bottomPanelHeight).toBe(320);
    expect(ui.getState().bottomPanelHeightCommitted).toBe(320);
    stop();
  });

  it('writes the open state at once and the height only when a resize ends', async () => {
    const backend = createMemorySettingsBackend();
    const settings = createTestSettings(backend);
    await settings.whenHydrated();
    const ui = createUiStore('dark');
    const stop = installBottomDock({ settings, ui });

    ui.getState().showBottomPanelView('fretboard');
    expect(settings.get(BOTTOM_DOCK_OPEN_SETTING)).toBe(true);
    ui.getState().setBottomPanelHeight(260);
    expect(settings.get(BOTTOM_DOCK_HEIGHT_SETTING)).toBe(200);
    ui.getState().persistBottomPanelHeight();
    expect(settings.get(BOTTOM_DOCK_HEIGHT_SETTING)).toBe(260);
    ui.getState().setBottomPanelOpen(false);
    await settings.settled();
    expect(backend.rows.get('layout.bottomDockOpen')).toBe(false);
    expect(backend.rows.get('layout.bottomDockHeight')).toBe(260);
    stop();
  });

  it('keeps a change made before the load over the stored rows', async () => {
    const backend = createMemorySettingsBackend([['layout.bottomDockOpen', false]]);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    const stop = installBottomDock({ settings, ui });
    ui.getState().showBottomPanelView('fretboard');
    await settings.whenHydrated();
    expect(ui.getState().bottomPanel.open).toBe(true);
    expect(settings.get(BOTTOM_DOCK_OPEN_SETTING)).toBe(true);
    stop();
  });

  it('stops writing after its cleanup', async () => {
    const settings = createTestSettings();
    await settings.whenHydrated();
    const ui = createUiStore('dark');
    installBottomDock({ settings, ui })();
    ui.getState().showBottomPanelView('fretboard');
    expect(settings.get(BOTTOM_DOCK_OPEN_SETTING)).toBe(false);
  });
});
