import { describe, expect, it } from 'vitest';

import { CommandRegistry, type Command } from '../command-registry';
import { createMenuRegistry } from './menu-registry';
import type { MenuContribution } from './types';

const run = () => undefined;

function registryOf(...commands: Command[]) {
  const registry = new CommandRegistry();
  for (const command of commands) registry.register(command);
  return registry;
}

const global = { id: 'view.zoomIn', title: 'Zoom in', run };
const editing = { id: 'editor.rest', title: 'Rest', context: 'editing', run } as const;

const contribute = (item: MenuContribution['items'][number]): MenuContribution[] => [
  { surface: 'header', items: [item] },
];

describe('createMenuRegistry', () => {
  it('refuses a command that is not registered', () => {
    expect(() =>
      createMenuRegistry(
        registryOf(global),
        contribute({ command: 'view.zoomOut', group: 'view' }),
      ),
    ).toThrow(/unknown command "view.zoomOut"/);
  });

  it('refuses an editing command listed for play mode', () => {
    expect(() =>
      createMenuRegistry(
        registryOf(editing),
        contribute({ command: 'editor.rest', group: 'edit', modes: ['play', 'edit'] }),
      ),
    ).toThrow(/editing command "editor.rest" in play mode/);
  });

  it('refuses an unknown group', () => {
    expect(() =>
      createMenuRegistry(
        registryOf(global),
        // @ts-expect-error a group that does not exist
        contribute({ command: 'view.zoomIn', group: 'nope' }),
      ),
    ).toThrow(/Unknown menu group "nope"/);
  });

  it('defaults an editing command to edit mode and any other to both', () => {
    const menus = createMenuRegistry(registryOf(global, editing), [
      {
        surface: 'header',
        items: [
          { command: 'view.zoomIn', group: 'view' },
          { command: 'editor.rest', group: 'edit' },
        ],
      },
    ]);
    expect(menus.itemsOf('header').map((item) => item.modes)).toEqual([['play', 'edit'], ['edit']]);
  });
});
