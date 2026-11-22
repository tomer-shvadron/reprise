import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import {
  acceleratorOf,
  historyItemLabel,
  MENU_COMMANDS,
  menuTemplate,
  type MenuOptions,
} from './menu';

/** Keys as the renderer sends them (the app's defaults). */
const KEYS: NonNullable<MenuOptions['keys']> = {
  'app.settings': { key: ',', mod: true },
  'file.new': { key: 'n', mod: true },
  'file.export': { key: 'e', mod: true, shift: true },
  'edit.undo': { key: 'z', mod: true },
  'edit.redo': { key: 'z', mod: true, shift: true },
};

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ]);
}

/** Our click handlers ignore Electron's arguments, so a test can call them with none. */
function press(item: MenuItemConstructorOptions | undefined): void {
  const click: ((...args: never[]) => void) | undefined = item?.click;
  click?.();
}

function template(overrides: Partial<MenuOptions> = {}) {
  const options: MenuOptions = {
    isMac: true,
    isPackaged: true,
    docsUrl: 'https://example.com/docs',
    sendCommand: vi.fn(),
    openExternal: vi.fn(),
    keys: KEYS,
    ...overrides,
  };
  return { options, items: flatten(menuTemplate(options)) };
}

describe('menuTemplate', () => {
  it('sends every menu command to the renderer once', () => {
    const { options, items } = template();

    for (const [id, { label }] of Object.entries(MENU_COMMANDS)) {
      const matches = items.filter((item) => item.label === label);
      expect(matches).toHaveLength(1);
      press(matches[0]);
      expect(options.sendCommand).toHaveBeenLastCalledWith(id);
    }
  });

  it('puts an Export submenu under Save As in the File menu', () => {
    const { items, options } = template();
    const file = items.find((item) => item.label === 'File');
    const entries = Array.isArray(file?.submenu) ? file.submenu : [];
    const labels = entries.map((item) => item.label);
    const exported = entries[labels.indexOf('Export')];

    expect(labels.indexOf('Export')).toBe(labels.indexOf('Save As…') + 1);
    const inside = Array.isArray(exported?.submenu) ? exported.submenu : [];
    expect(inside.map((item) => item.label)).toEqual(['Guitar Pro…', 'ASCII Tab…', 'Image…']);
    expect(inside[0]).toMatchObject({ accelerator: 'CmdOrCtrl+Shift+E' });
    expect(inside[1]).not.toHaveProperty('accelerator');
    press(inside[1]);
    expect(options.sendCommand).toHaveBeenLastCalledWith('file.exportAsciiTab');
    expect(inside[2]).not.toHaveProperty('accelerator');
    press(inside[2]);
    expect(options.sendCommand).toHaveBeenLastCalledWith('file.exportImage');
  });

  it('puts New Song first in the File menu on CmdOrCtrl+N', () => {
    const { items } = template();
    const file = items.find((item) => item.label === 'File');
    const first = Array.isArray(file?.submenu) ? file.submenu[0] : undefined;

    expect(first).toMatchObject({ label: 'New Song', accelerator: 'CmdOrCtrl+N' });
  });

  it('uses roles for the clipboard, and puts Quit in File only off macOS', () => {
    const roles = (items: MenuItemConstructorOptions[]) => items.map(({ role }) => role);

    expect(roles(template().items)).toEqual(
      expect.arrayContaining(['appMenu', 'cut', 'copy', 'paste', 'windowMenu']),
    );
    // Undo and redo are the renderer's commands, which leave a text field its own history.
    expect(roles(template().items)).not.toContain('undo');
    expect(roles(template().items)).not.toContain('redo');
    // On macOS Quit is in the application menu, not in File.
    const fileRoles = (items: MenuItemConstructorOptions[]) => {
      const file = items.find((item) => item.label === 'File');
      return Array.isArray(file?.submenu) ? file.submenu.map(({ role }) => role) : [];
    };
    expect(fileRoles(template().items)).not.toContain('quit');
    expect(fileRoles(template({ isMac: false }).items)).toContain('quit');
    expect(roles(template({ isMac: false }).items)).not.toContain('appMenu');
  });

  it('offers dev tools only in development', () => {
    const roles = (items: MenuItemConstructorOptions[]) => items.map(({ role }) => role);
    expect(roles(template().items)).not.toContain('toggleDevTools');
    expect(roles(template({ isPackaged: false }).items)).toContain('toggleDevTools');
  });

  it('opens the documentation from Help', () => {
    const { options, items } = template();
    press(items.find((item) => item.label === 'Reprise Documentation'));
    expect(options.openExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('lists the recent songs under Open Recent and opens one by id', () => {
    const { options, items } = template({
      recent: [
        { id: 's1', title: 'Master & Puppets' },
        { id: 's2', title: 'Enter Sandman' },
      ],
      openRecent: vi.fn(),
    });

    const entry = items.find((item) => item.label === 'Master && Puppets');
    press(entry);

    expect(options.openRecent).toHaveBeenCalledWith('s1');
    expect(items.some((item) => item.label === 'Enter Sandman')).toBe(true);
  });

  it('shows a disabled placeholder when nothing is recent', () => {
    const { items } = template();

    expect(items.find((item) => item.label === 'No Recent Songs')).toMatchObject({
      enabled: false,
    });
  });
});

describe('menu keys', () => {
  it.each([
    [{ key: 'n', mod: true }, 'CmdOrCtrl+N'],
    [{ key: 'z', mod: true, shift: true }, 'CmdOrCtrl+Shift+Z'],
    [{ key: 'F4' }, 'F4'],
    [{ key: 'F9', shift: true, alt: true }, 'Alt+Shift+F9'],
    [{ key: ',', mod: true }, 'CmdOrCtrl+,'],
    [{ key: '=', mod: true }, 'CmdOrCtrl+='],
    [{ key: '-', mod: true }, 'CmdOrCtrl+-'],
    [{ key: '0', mod: true }, 'CmdOrCtrl+0'],
    // Shift is implied by a punctuation character.
    [{ key: '?', shift: true }, '?'],
    [{ key: '+', mod: true, shift: true }, 'CmdOrCtrl+Plus'],
    [{ key: ' ' }, 'Space'],
    [{ key: 'ArrowLeft', mod: true }, 'CmdOrCtrl+Left'],
    [{ key: 'ArrowUp' }, 'Up'],
    [{ key: 'Enter', alt: true }, 'Alt+Return'],
    [{ key: 'Home' }, 'Home'],
  ])('turns %j into %s', (key, accelerator) => {
    expect(acceleratorOf(key)).toBe(accelerator);
  });

  it('gives an item the key the renderer sent, and none to the rest', () => {
    const { items } = template({ keys: { 'file.save': { key: 's', mod: true } } });

    expect(items.find((item) => item.label === 'Save')?.accelerator).toBe('CmdOrCtrl+S');
    expect(items.find((item) => item.label === 'New Song')?.accelerator).toBeUndefined();
  });

  it('shows no key at all before the renderer sends them', () => {
    const { items } = template({ keys: {} });

    expect(items.filter((item) => item.accelerator !== undefined)).toEqual([]);
  });

  it('shows no key for a command the renderer cleared', () => {
    const { items } = template({ keys: { 'file.new': null } });

    expect(items.find((item) => item.label === 'New Song')?.accelerator).toBeUndefined();
  });
});

describe('the Edit menu history items', () => {
  const edit = (items: MenuItemConstructorOptions[]) => {
    const submenu = items.find((item) => item.label === 'Edit')?.submenu;
    return Array.isArray(submenu) ? submenu : [];
  };

  it('builds the label from the command name, escaping a lone &', () => {
    expect(historyItemLabel('Undo', undefined)).toBe('Undo');
    expect(historyItemLabel('Undo', 'setNote')).toBe('Undo setNote');
    expect(historyItemLabel('Redo', 'Fish & Chips')).toBe('Redo Fish && Chips');
  });

  it('keeps plain items until the renderer reports', () => {
    const [undo, redo] = edit(template().items);

    expect(undo).toMatchObject({ label: 'Undo', accelerator: 'CmdOrCtrl+Z' });
    expect(redo).toMatchObject({ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' });
  });

  it('names the steps, shows the plain name for an empty stack, and never disables', () => {
    const { options, items } = template({ history: { undo: 'setNote' } });
    const [undo, redo] = edit(items);

    expect(undo).toMatchObject({ label: 'Undo setNote', accelerator: 'CmdOrCtrl+Z' });
    expect(redo).toMatchObject({ label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z' });
    expect(undo?.enabled).toBeUndefined();
    expect(redo?.enabled).toBeUndefined();
    press(undo);
    expect(options.sendCommand).toHaveBeenLastCalledWith('edit.undo');
  });

  it('leaves the other items as they were', () => {
    const plain = flatten(menuTemplate(template().options)).map((item) => item.label);
    const named = flatten(
      menuTemplate(template({ history: { undo: 'x', redo: 'y' } }).options),
    ).map((item) => item.label);

    expect(
      named.filter((label) => !label?.startsWith('Undo') && !label?.startsWith('Redo')),
    ).toEqual(plain.filter((label) => label !== 'Undo' && label !== 'Redo'));
  });
});

describe('Settings…', () => {
  const submenuOf = (
    items: MenuItemConstructorOptions[],
    pick: (item: MenuItemConstructorOptions) => boolean,
  ) => {
    const menu = items.find(pick);
    return Array.isArray(menu?.submenu) ? menu.submenu : [];
  };

  it('sits under About in the macOS app menu, before Services, Hide and Quit', () => {
    const { items } = template();
    const app = submenuOf(items, (item) => item.role === 'appMenu');
    const names = app.map((item) => item.role ?? item.label ?? item.type);

    expect(names).toEqual([
      'about',
      'separator',
      'Settings…',
      'separator',
      'services',
      'separator',
      'hide',
      'hideOthers',
      'unhide',
      'separator',
      'quit',
    ]);
    expect(app.find((item) => item.label === 'Settings…')?.accelerator).toBe('CmdOrCtrl+,');
  });

  it('is in the File menu before Quit off macOS, and sends app.settings', () => {
    const { options, items } = template({ isMac: false });
    const file = submenuOf(items, (item) => item.label === 'File');
    const names = file.map((item) => item.role ?? item.label);

    expect(names.indexOf('Settings…')).toBeGreaterThan(names.indexOf('Print…'));
    expect(names.indexOf('Settings…')).toBeLessThan(names.indexOf('quit'));
    press(file.find((item) => item.label === 'Settings…'));
    expect(options.sendCommand).toHaveBeenCalledWith('app.settings');
  });
});

describe('About Reprise', () => {
  it('is in the Help menu on Windows and calls showAbout', () => {
    const showAbout = vi.fn();
    const { items } = template({ isMac: false, showAbout });
    const matches = items.filter((item) => item.label === 'About Reprise');

    expect(matches).toHaveLength(1);
    press(matches[0]);
    expect(showAbout).toHaveBeenCalledOnce();
  });

  it('is left to the application menu on macOS', () => {
    const { items } = template({ isMac: true });

    expect(items.some((item) => item.label === 'About Reprise')).toBe(false);
  });

  describe('the Playback menu', () => {
    const playback = (overrides: Partial<MenuOptions> = {}) => {
      const made = template(overrides);
      const menu = menuTemplate(made.options).find((item) => item.label === 'Playback');
      const entries = Array.isArray(menu?.submenu) ? menu.submenu : [];
      return { ...made, menu, entries };
    };
    const shape = (entries: MenuItemConstructorOptions[]) =>
      entries.map((item) => (item.type === 'separator' ? '-' : item.label));

    it('sits between View and Window, in five groups', () => {
      const top = menuTemplate(template().options).map((item) => item.label ?? item.role);
      expect(top.indexOf('Playback')).toBe(top.indexOf('View') + 1);
      expect(top[top.indexOf('Playback') + 1]).toBe('windowMenu');

      expect(shape(playback().entries)).toEqual([
        'Play/Pause',
        'Stop',
        'Play from Start',
        'Play from Selection',
        '-',
        'Loop',
        'Loop Selection',
        '-',
        'Count-in',
        'Metronome',
        'Metronome Volume…',
        '-',
        'Set Tempo…',
        'Slow Down 5%',
        'Speed Up 5%',
        'Toggle Relative Speed',
        'Fixed Tempo',
        '-',
        'Master Volume…',
      ]);
    });

    it('shows the keys the renderer sent, Alt-only ones included', () => {
      const { entries } = playback({
        keys: {
          'transport.toggleLoop': { key: 'F9' },
          'transport.toggleSpeed': { key: 'F9', mod: true },
          'transport.toggleCountIn': { key: 'c', alt: true },
          'transport.metronomeVolume': { key: 'm', alt: true, shift: true },
          'transport.playPause': null,
        },
      });
      const accelerators: Record<string, string | undefined> = {};
      for (const item of entries) {
        if (item.label !== undefined) accelerators[item.label] = item.accelerator;
      }
      expect(accelerators['Loop']).toBe('F9');
      expect(accelerators['Toggle Relative Speed']).toBe('CmdOrCtrl+F9');
      expect(accelerators['Count-in']).toBe('Alt+C');
      expect(accelerators['Metronome Volume…']).toBe('Alt+Shift+M');
      expect(accelerators['Play/Pause']).toBeUndefined();
    });

    it('makes Loop, Count-in, Metronome and Fixed Tempo checkboxes that follow the option', () => {
      const boxes = ['Loop', 'Count-in', 'Metronome', 'Fixed Tempo'];
      const none = playback().entries.filter((item) => item.type === 'checkbox');
      expect(none.map((item) => item.label)).toEqual(boxes);
      expect(none.every((item) => item.checked === false)).toBe(true);

      const some = playback({
        checked: { 'transport.toggleLoop': true, 'transport.toggleMetronome': true },
      }).entries.filter((item) => item.type === 'checkbox');
      expect(some.map((item) => item.checked)).toEqual([true, false, true, false]);
    });

    it('names the steps in BPM while Fixed Tempo is on', () => {
      const { entries } = playback({ checked: { 'transport.toggleFixedTempo': true } });
      expect(shape(entries)).toContain('Slow Down 5 BPM');
      expect(shape(entries)).toContain('Speed Up 5 BPM');
      expect(shape(entries)).not.toContain('Slow Down 5%');
    });

    it('puts a checkbox back to the pushed state when Electron flips it', () => {
      const { entries, options } = playback({ checked: { 'transport.toggleCountIn': true } });
      const tick = (label: string) => {
        const entry = entries.find((item) => item.label === label);
        const item = { checked: label === 'Loop' };
        const click = entry?.click as ((...args: unknown[]) => void) | undefined;
        // Electron has flipped the tick by the time the handler runs.
        item.checked = !item.checked;
        click?.(item, undefined, {});
        return item.checked;
      };

      // Loop with no song open: the renderer pushes nothing, so the tick stays off.
      expect(tick('Loop')).toBe(false);
      expect(options.sendCommand).toHaveBeenLastCalledWith('transport.toggleLoop');
      expect(tick('Count-in')).toBe(true);
    });

    it('sends whether an Alt key or the menu ran an item', () => {
      const { entries, options } = playback();
      const loop = entries.find((item) => item.label === 'Loop');
      const click = loop?.click as ((...args: unknown[]) => void) | undefined;
      const item = { checked: false };
      click?.(item, undefined, { triggeredByAccelerator: true, altKey: true });
      expect(options.sendCommand).toHaveBeenLastCalledWith('transport.toggleLoop', true);
      // Keyboard menu navigation and screen readers are "accelerator" activations without Alt.
      click?.(item, undefined, { triggeredByAccelerator: true, altKey: false });
      expect(options.sendCommand).toHaveBeenLastCalledWith('transport.toggleLoop');
      click?.(item, undefined, { triggeredByAccelerator: false, altKey: true });
      expect(options.sendCommand).toHaveBeenLastCalledWith('transport.toggleLoop');
    });
  });
});
