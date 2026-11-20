import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { CommandRegistry, type Command } from '../command-registry';
import { createMenuRegistry } from './menu-registry';
import { resolveMenu, type ResolvedEntry } from './resolve-menu';
import type { MenuContext, MenuContribution, MenuMode } from './types';

const run = () => undefined;
const services = createTestServices();

function command(id: string, extra: Partial<Command> = {}): Command {
  return { id, title: id, run, ...extra };
}

let editingNow = false;
const registry = new CommandRegistry(() => editingNow);
for (const each of [
  command('view.zoomIn', { title: 'Zoom in', shortcut: { key: '=', mod: true } }),
  command('view.zoomOut', { title: 'Zoom out' }),
  command('view.zoomReset', { title: 'Actual size' }),
  command('track.toggleMute', { title: 'Mute', enabled: () => false }),
  command('editor.rest', { context: 'editing', title: 'Rest' }),
  command('editor.deleteBeatMac', { shortcut: { key: 'Backspace', only: 'mac' } }),
  command('editor.deleteBeatWindows', { shortcut: { key: 'Delete', only: 'other' } }),
  command('transport.playFromStart', { title: 'Play from start' }),
  command('transport.toggleLoop', { title: 'Loop' }),
]) {
  registry.register(each);
}

const menu = (contributions: MenuContribution[]) => createMenuRegistry(registry, contributions);

function resolve(
  contributions: MenuContribution[],
  surface: MenuContribution['surface'],
  mode: MenuMode = 'play',
  keyboard: 'mac' | 'other' = 'mac',
) {
  editingNow = mode === 'edit';
  const at: MenuContext = { services, target: { kind: 'paper' }, mode };
  return resolveMenu(menu(contributions), registry, surface, at, keyboard);
}

const shape = (entries: ResolvedEntry[]): unknown[] =>
  entries.map((entry) =>
    entry.kind === 'item'
      ? entry.label
      : entry.kind === 'separator'
        ? '---'
        : { [entry.title]: shape(entry.entries) },
  );

describe('resolveMenu', () => {
  it('orders by group, then contribution order, with a separator between groups', () => {
    const entries = resolve(
      [
        {
          surface: 'header',
          items: [
            { command: 'view.zoomOut', group: 'view' },
            { command: 'transport.playFromStart', group: 'play' },
            { command: 'view.zoomIn', group: 'view' },
          ],
        },
      ],
      'header',
    );
    expect(shape(entries)).toEqual(['Play from start', '---', 'Zoom out', 'Zoom in']);
  });

  it('lists a command once', () => {
    const entries = resolve(
      [
        {
          surface: 'header',
          items: [
            { command: 'view.zoomIn', group: 'view' },
            { command: 'view.zoomIn', group: 'properties', label: 'Again' },
          ],
        },
      ],
      'header',
    );
    expect(shape(entries)).toEqual(['Zoom in']);
  });

  it('shows a command that is not enabled as disabled, and hides what a `when` hides', () => {
    const entries = resolve(
      [
        {
          surface: 'header',
          items: [
            { command: 'track.toggleMute', group: 'track' },
            { command: 'view.zoomIn', group: 'view', when: () => false },
          ],
        },
      ],
      'header',
    );
    expect(entries).toMatchObject([{ kind: 'item', label: 'Mute', enabled: false }]);
  });

  it('takes the label, and the checked state, from the item', () => {
    const entries = resolve(
      [
        {
          surface: 'header',
          items: [
            {
              command: 'transport.toggleLoop',
              group: 'play',
              label: ({ mode }) => `Loop (${mode})`,
              checked: () => true,
            },
          ],
        },
      ],
      'header',
    );
    expect(entries).toMatchObject([{ label: 'Loop (play)', checked: true }]);
  });

  it('drops an editing command in play mode and keeps it in edit mode', () => {
    const items: MenuContribution[] = [
      {
        surface: 'header',
        items: [
          { command: 'editor.rest', group: 'edit' },
          { command: 'view.zoomIn', group: 'view' },
        ],
      },
    ];
    expect(shape(resolve(items, 'header', 'play'))).toEqual(['Zoom in']);
    expect(shape(resolve(items, 'header', 'edit'))).toEqual(['Rest', '---', 'Zoom in']);
  });

  it('picks the platform twin bound on this platform', () => {
    const items: MenuContribution[] = [
      {
        surface: 'header',
        items: [{ command: ['editor.deleteBeatMac', 'editor.deleteBeatWindows'], group: 'edit' }],
      },
    ];
    expect(resolve(items, 'header', 'play', 'mac')).toMatchObject([{ id: 'editor.deleteBeatMac' }]);
    expect(resolve(items, 'header', 'play', 'other')).toMatchObject([
      { id: 'editor.deleteBeatWindows' },
    ]);
  });

  describe('score levels', () => {
    const items: MenuContribution[] = [
      { surface: 'score.note', items: [{ command: 'editor.rest', group: 'note' }] },
      { surface: 'score.beat', items: [{ command: 'view.zoomOut', group: 'beat' }] },
      { surface: 'score.bar', items: [{ command: 'view.zoomReset', group: 'bar' }] },
    ];

    it('merges the parent levels flat in play mode', () => {
      expect(shape(resolve(items, 'score.note', 'play'))).toEqual([
        'Zoom out',
        '---',
        'Actual size',
      ]);
    });

    it('makes each parent level a submenu in edit mode', () => {
      expect(shape(resolve(items, 'score.note', 'edit'))).toEqual([
        'Rest',
        '---',
        { Beat: ['Zoom out'] },
        '---',
        { Bar: ['Actual size'] },
      ]);
    });
  });
});
