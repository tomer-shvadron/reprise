import { describe, expect, it } from 'vitest';

import { RIGHT_PANEL_OPEN_SETTING, RIGHT_PANEL_WIDTH_SETTING } from '@/state/app-settings';
import type { SettingsBackend } from '@/state/settings';
import { createUiStore } from '@/state/ui';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { installRightPanel, storeRightPanelWidth } from './install-right-panel';

const STORED: [string, unknown][] = [
  ['layout.rightPanelOpen', true],
  ['layout.rightPanelWidth', 400],
];

/** A backend whose load waits for `release`, so a test can act before the rows arrive. */
function gatedBackend(rows: [string, unknown][]) {
  const inner = createMemorySettingsBackend(rows);
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const backend: SettingsBackend = {
    ...inner,
    load: async () => {
      await gate;
      return inner.load();
    },
  };
  return { backend, release, rows: inner.rows };
}

describe('installRightPanel', () => {
  it('shows the stored open state, as a restored one, and the stored width', async () => {
    const settings = createTestSettings(createMemorySettingsBackend(STORED));
    const ui = createUiStore('dark');
    installRightPanel({ settings, ui });
    await settings.whenHydrated();

    expect(ui.getState().panels.rightPanel).toBe(true);
    expect(ui.getState().panelRestored).toBe(true);
    expect(ui.getState().panelWidths.rightPanel).toBe(400);
  });

  it('does not write back what it restored, and a user change clears the restored mark', async () => {
    const backend = createMemorySettingsBackend(STORED);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    installRightPanel({ settings, ui });
    await settings.whenHydrated();
    await settings.settled();
    ui.getState().showPanelView('history');

    expect(ui.getState().panelRestored).toBe(false);
    ui.getState().setPanelOpen('rightPanel', false);
    expect(settings.get(RIGHT_PANEL_OPEN_SETTING)).toBe(false);
  });

  it('writes an open or collapse at once, and the width when a resize ends', () => {
    const settings = createTestSettings();
    const ui = createUiStore('dark');
    const stop = installRightPanel({ settings, ui });

    ui.getState().showPanelView('tuner');
    expect(settings.get(RIGHT_PANEL_OPEN_SETTING)).toBe(true);
    ui.getState().setPanelWidth('rightPanel', 380);
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(320);
    storeRightPanelWidth({ settings, ui });
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(380);
    ui.getState().togglePanel('rightPanel');
    expect(settings.get(RIGHT_PANEL_OPEN_SETTING)).toBe(false);
    stop();
  });

  it('keeps a width set before the load over the stored row', async () => {
    const { backend, release } = gatedBackend(STORED);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    installRightPanel({ settings, ui });

    ui.getState().setPanelWidth('rightPanel', 450);
    storeRightPanelWidth({ settings, ui });
    release();
    await settings.whenHydrated();

    expect(ui.getState().panelWidths.rightPanel).toBe(450);
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(450);
  });

  it('keeps a width equal to the default, set before the load, over the stored row', async () => {
    const { backend, release } = gatedBackend(STORED);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    installRightPanel({ settings, ui });

    ui.getState().setPanelWidth('rightPanel', 300);
    ui.getState().setPanelWidth('rightPanel', 320);
    storeRightPanelWidth({ settings, ui });
    release();
    await settings.whenHydrated();

    expect(ui.getState().panelWidths.rightPanel).toBe(320);
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(320);
  });

  it('keeps an open state set before the load over the stored row, even the default one', async () => {
    const { backend, release } = gatedBackend(STORED);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    installRightPanel({ settings, ui });

    // The panel starts closed, the default; the user opens it and closes it again.
    ui.getState().setPanelOpen('rightPanel', true);
    ui.getState().setPanelOpen('rightPanel', false);
    release();
    await settings.whenHydrated();

    expect(ui.getState().panels.rightPanel).toBe(false);
    expect(settings.get(RIGHT_PANEL_OPEN_SETTING)).toBe(false);
  });
});
