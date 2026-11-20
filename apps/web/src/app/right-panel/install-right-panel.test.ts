import { afterEach, describe, expect, it, vi } from 'vitest';

import { RIGHT_PANEL_OPEN_SETTING, RIGHT_PANEL_WIDTH_SETTING } from '@/state/app-settings';
import { createUiStore } from '@/state/ui';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { installRightPanel } from './install-right-panel';

afterEach(() => {
  vi.useRealTimers();
});

describe('installRightPanel', () => {
  it('shows the stored open state and width', async () => {
    const settings = createTestSettings(
      createMemorySettingsBackend([
        ['layout.rightPanelOpen', true],
        ['layout.rightPanelWidth', 400],
      ]),
    );
    const ui = createUiStore('dark');
    installRightPanel({ settings, ui });
    await settings.whenHydrated();

    expect(ui.getState().panels.rightPanel).toBe(true);
    expect(ui.getState().panelWidths.rightPanel).toBe(400);
  });

  it('writes an open or collapse, and the width once a resize settles', () => {
    vi.useFakeTimers();
    const settings = createTestSettings();
    const ui = createUiStore('dark');
    const stop = installRightPanel({ settings, ui });

    ui.getState().showPanelView('tuner');
    expect(settings.get(RIGHT_PANEL_OPEN_SETTING)).toBe(true);
    ui.getState().setPanelWidth('rightPanel', 350);
    ui.getState().setPanelWidth('rightPanel', 380);
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(320);
    vi.advanceTimersByTime(300);
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(380);
    ui.getState().togglePanel('rightPanel');
    expect(settings.get(RIGHT_PANEL_OPEN_SETTING)).toBe(false);
    stop();
  });

  it('flushes a pending width on cleanup', () => {
    vi.useFakeTimers();
    const settings = createTestSettings();
    const ui = createUiStore('dark');
    const stop = installRightPanel({ settings, ui });
    ui.getState().setPanelWidth('rightPanel', 450);
    stop();
    expect(settings.get(RIGHT_PANEL_WIDTH_SETTING)).toBe(450);
  });
});
