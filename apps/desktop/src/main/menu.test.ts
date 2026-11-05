import type { MenuItemConstructorOptions } from 'electron';
import { describe, expect, it, vi } from 'vitest';

import { MENU_COMMANDS, menuTemplate, type MenuOptions } from './menu';

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

  it('uses roles for editing, and puts Quit in File only off macOS', () => {
    const roles = (items: MenuItemConstructorOptions[]) => items.map(({ role }) => role);

    expect(roles(template().items)).toEqual(
      expect.arrayContaining(['appMenu', 'undo', 'redo', 'cut', 'copy', 'paste', 'windowMenu']),
    );
    expect(roles(template().items)).not.toContain('quit');
    expect(roles(template({ isMac: false }).items)).toContain('quit');
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
});
