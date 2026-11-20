import { describe, expect, it } from 'vitest';

import { DEFAULT_VIEW_MODE_SETTING, DEFAULT_ZOOM_SETTING } from '@/state/app-settings';
import { createUiStore } from '@/state/ui';
import { createAppRegistry } from './app-registry';
import { createTestServices } from '@/test/services';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { installViewDefaults } from './install-view-defaults';

describe('installViewDefaults', () => {
  it('starts from the paged, 100% defaults', () => {
    const ui = createUiStore('dark');
    expect(ui.getState().view.mode).toBe('paged');
    expect(ui.getState().zoom).toBe(1);
  });

  it('applies the stored view and zoom once the settings load', async () => {
    const backend = createMemorySettingsBackend([
      [DEFAULT_VIEW_MODE_SETTING.key, 'continuous'],
      [DEFAULT_ZOOM_SETTING.key, 1.5],
    ]);
    const settings = createTestSettings(backend);
    const ui = createUiStore('dark');
    installViewDefaults({ settings, ui });
    expect(ui.getState().view.mode).toBe('paged');

    await settings.whenHydrated();

    expect(ui.getState().view.mode).toBe('continuous');
    expect(ui.getState().zoom).toBe(1.5);
  });

  it('applies a change made in Settings now, and F4 or zoom commands never write back', async () => {
    const services = createTestServices();
    await services.settings.whenHydrated();
    const registry = createAppRegistry(services);
    installViewDefaults(services);

    services.settings.set(DEFAULT_ZOOM_SETTING, 2);
    expect(services.ui.getState().zoom).toBe(2);

    void registry.get('view.toggleViewMode')?.run();
    void registry.get('view.zoomIn')?.run();
    void registry.get('view.zoomReset')?.run();

    expect(services.ui.getState().view.mode).toBe('continuous');
    expect(services.settings.get(DEFAULT_VIEW_MODE_SETTING)).toBe('paged');
    expect(services.settings.get(DEFAULT_ZOOM_SETTING)).toBe(2);
  });

  it('stops applying after cleanup', async () => {
    const settings = createTestSettings();
    await settings.whenHydrated();
    const ui = createUiStore('dark');
    const stop = installViewDefaults({ settings, ui });
    stop();
    settings.set(DEFAULT_ZOOM_SETTING, 2);
    expect(ui.getState().zoom).toBe(1);
  });
});
