import { describe, expect, it, vi } from 'vitest';

import { MENU_COMMAND_IDS } from '@/platform/bridge';
import type { MenuKeys } from '@/platform/bridge';
import { createTestServices } from '@/test/services';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';

import { createAppRegistry } from './app-registry';
import { installMenuKeys, menuKeyOf, menuKeysOf } from './install-menu-keys';

describe('menuKeyOf', () => {
  it('carries the modifiers that are set and no more', () => {
    expect(menuKeyOf({ key: 's', mod: true, shift: true })).toEqual({
      key: 's',
      mod: true,
      shift: true,
    });
    expect(menuKeyOf({ key: 'F4' })).toEqual({ key: 'F4' });
    expect(menuKeyOf({ key: 'a', alt: true })).toEqual({ key: 'a', alt: true });
  });

  it('gives null for a key with neither Cmd/Ctrl nor Alt, except an F-key', () => {
    for (const key of ['s', ' ', 'Enter', 'ArrowLeft', '?']) {
      expect(menuKeyOf({ key })).toBeNull();
      expect(menuKeyOf({ key, shift: true })).toBeNull();
    }
    expect(menuKeyOf({ key: 'F9', shift: true })).toEqual({ key: 'F9', shift: true });
    expect(menuKeyOf({ key: 'Enter', mod: true })).toEqual({ key: 'Enter', mod: true });
  });

  it('gives null for no key, and for a key the accelerator grammar cannot express', () => {
    expect(menuKeyOf(undefined)).toBeNull();
    expect(menuKeyOf({ key: 'é', mod: true })).toBeNull();
    expect(menuKeyOf({ key: 'א' })).toBeNull();
    expect(menuKeyOf({ key: 'Dead' })).toBeNull();
  });
});

describe('menuKeysOf', () => {
  // The keys the hand-kept menu table carried before the renderer sent them.
  const WAS: MenuKeys = {
    'app.settings': { key: ',', mod: true },
    'file.new': { key: 'n', mod: true },
    'file.open': { key: 'o', mod: true },
    'file.save': { key: 's', mod: true },
    'file.saveAs': { key: 's', mod: true, shift: true },
    'file.export': { key: 'e', mod: true, shift: true },
    'file.exportAsciiTab': null,
    'file.exportImage': null,
    'file.print': { key: 'p', mod: true },
    'edit.undo': { key: 'z', mod: true },
    'edit.redo': { key: 'z', mod: true, shift: true },
    'view.zoomIn': { key: '=', mod: true },
    'view.zoomOut': { key: '-', mod: true },
    'view.zoomReset': { key: '0', mod: true },
    'view.toggleTheme': { key: 'l', mod: true, shift: true },
    'view.toggleSidebar': null,
    'view.togglePanel': { key: 'F8' },
    'view.toggleViewMode': { key: 'F4' },
    'transport.playPause': null,
    'transport.stop': null,
    'transport.playFromStart': null,
    'transport.playFromSelection': null,
    'transport.toggleLoop': { key: 'F9' },
    'transport.loopSelection': null,
    'transport.toggleCountIn': { key: 'c', alt: true },
    'transport.toggleMetronome': { key: 'm', alt: true },
    'transport.metronomeVolume': { key: 'm', alt: true, shift: true },
    'transport.setTempo': { key: 't', alt: true },
    'transport.slowDown': null,
    'transport.speedUp': null,
    'transport.toggleSpeed': { key: 'F9', mod: true },
    'transport.toggleFixedTempo': null,
    'transport.masterVolume': { key: 'v', alt: true, shift: true },
  };

  it.each(['mac', 'other'] as const)("gives the menu the registry's keys on %s", (keyboard) => {
    const registry = createAppRegistry(createTestServices());

    expect(menuKeysOf(registry, keyboard)).toEqual(WAS);
  });

  it('covers every menu command', () => {
    const registry = createAppRegistry(createTestServices());

    expect(Object.keys(menuKeysOf(registry, 'mac')).sort()).toEqual([...MENU_COMMAND_IDS].sort());
  });
});

describe('installMenuKeys', () => {
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  const setup = () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const setMenuKeys = vi.fn<(keys: MenuKeys) => Promise<boolean>>(() => Promise.resolve(true));
    return { registry, setMenuKeys, settings: services.settings };
  };

  it('pushes nothing before the settings load, then the keys once', async () => {
    const settings = createTestSettings(createMemorySettingsBackend());
    const { registry, setMenuKeys } = setup();
    installMenuKeys({ registry, settings, platform: { setMenuKeys }, keyboard: 'mac' });

    expect(setMenuKeys).not.toHaveBeenCalled();
    await settings.whenHydrated();
    await Promise.resolve();

    expect(setMenuKeys).toHaveBeenCalledTimes(1);
    expect(setMenuKeys.mock.calls[0]?.[0]['file.save']).toEqual({ key: 's', mod: true });
  });

  it('re-pushes when told the keymap changed, and skips an unchanged map', async () => {
    const { registry, setMenuKeys, settings } = setup();
    let notify: () => void = () => undefined;
    installMenuKeys({
      registry,
      settings,
      platform: { setMenuKeys },
      keyboard: 'other',
      subscribe: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    await settings.whenHydrated();
    await settle();
    notify();
    expect(setMenuKeys).toHaveBeenCalledTimes(1);

    const save = registry.get('file.save');
    if (!save) throw new Error('no file.save');
    const inner = registry.shortcutOf.bind(registry);
    vi.spyOn(registry, 'shortcutOf').mockImplementation((command) =>
      command.id === 'file.save' ? { key: 'F2' } : inner(command),
    );
    notify();

    expect(setMenuKeys).toHaveBeenCalledTimes(2);
    expect(setMenuKeys.mock.calls[1]?.[0]['file.save']).toEqual({ key: 'F2' });
  });

  it('tries a refused push again on the next change, and stops once one is applied', async () => {
    const { registry, setMenuKeys, settings } = setup();
    setMenuKeys.mockResolvedValueOnce(false);
    let notify: () => void = () => undefined;
    installMenuKeys({
      registry,
      settings,
      platform: { setMenuKeys },
      keyboard: 'mac',
      subscribe: (listener) => {
        notify = listener;
        return () => undefined;
      },
    });
    await settings.whenHydrated();
    await settle();
    expect(setMenuKeys).toHaveBeenCalledTimes(1);

    notify();
    await settle();
    expect(setMenuKeys).toHaveBeenCalledTimes(2);

    notify();
    expect(setMenuKeys).toHaveBeenCalledTimes(2);
  });

  it('does nothing on a platform without a menu, and stops after the undo', async () => {
    const { registry, setMenuKeys, settings } = setup();
    const stopIdle = installMenuKeys({ registry, settings, platform: {}, keyboard: 'mac' });
    expect(() => {
      stopIdle();
    }).not.toThrow();

    const stop = installMenuKeys({
      registry,
      settings,
      platform: { setMenuKeys },
      keyboard: 'mac',
    });
    stop();
    await settings.whenHydrated();
    await Promise.resolve();

    expect(setMenuKeys).not.toHaveBeenCalled();
  });
});
