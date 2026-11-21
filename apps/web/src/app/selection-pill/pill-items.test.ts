import { describe, expect, it } from 'vitest';

import { createTestServices } from '@/test/services';

import { createAppMenus } from '../app-menus';
import { createAppRegistry } from '../app-registry';
import { createMenuRegistry } from '../context-menu/menu-registry';
import type { MenuContext } from '../context-menu/types';
import { checkPillItems, PLAY_PILL, resolvePillItems, type PillSpec } from './pill-items';

const services = createTestServices();
const registry = createAppRegistry(services, 'other');
const menus = createAppMenus(registry);
const at = (mode: MenuContext['mode'] = 'play'): MenuContext => ({
  services,
  target: { kind: 'range' },
  mode,
});

describe('checkPillItems', () => {
  it('passes on the app’s menus', () => {
    expect(() => {
      checkPillItems(menus, registry);
    }).not.toThrow();
  });

  it('throws when an item is not on the surface it mirrors', () => {
    const bare = createMenuRegistry(registry, [
      {
        surface: 'score.range',
        items: [{ command: 'transport.loopSelection', group: 'practice' }],
      },
    ]);
    expect(() => {
      checkPillItems(bare, registry);
    }).toThrow(/trainer\.speedTrainerOnSelection/);
  });

  it('throws when an item is on the surface only in another mode', () => {
    const spec: PillSpec = {
      surface: 'score.range',
      mode: 'play',
      items: [{ key: 'loop', command: 'transport.loopSelection', text: 'Loop' }],
    };
    const edit = createMenuRegistry(registry, [
      {
        surface: 'score.range',
        items: [{ command: 'transport.loopSelection', group: 'practice', modes: ['edit'] }],
      },
    ]);
    expect(() => {
      checkPillItems(edit, registry, [spec]);
    }).toThrow(/does not offer/);
  });

  it('counts a parent level’s item as offered', () => {
    const spec: PillSpec = {
      surface: 'score.range',
      mode: 'play',
      items: [{ key: 'loop', command: 'transport.loopSelection', text: 'Loop' }],
    };
    const parent = createMenuRegistry(registry, [
      { surface: 'score.bar', items: [{ command: 'transport.loopSelection', group: 'practice' }] },
    ]);
    expect(() => {
      checkPillItems(parent, registry, [spec]);
    }).not.toThrow();
  });

  it('throws on an unknown pressed command', () => {
    const spec: PillSpec = {
      surface: 'score.range',
      mode: 'play',
      items: [
        {
          key: 'loop',
          command: 'transport.loopSelection',
          // @ts-expect-error not a registered command
          pressedCommand: 'transport.nope',
          text: 'Loop',
        },
      ],
    };
    expect(() => {
      checkPillItems(menus, registry, [spec]);
    }).toThrow(/unknown command/);
  });
});

describe('resolvePillItems', () => {
  const resolve = (practising = false) => {
    services.ui.setState((state) => ({ practiceMode: { ...state.practiceMode, on: practising } }));
    return resolvePillItems(menus, registry, PLAY_PILL, at(), 'other');
  };

  it('takes its labels from the menu', () => {
    expect(resolve().map((item) => item.label)).toEqual([
      'Loop these bars',
      'Speed trainer on these bars',
      'Focus on loop',
      'Copy bars',
    ]);
  });

  it('names every item with its visible word, as WCAG 2.5.3 asks', () => {
    for (const { spec, label } of resolve()) {
      expect(label.toLowerCase()).toContain(spec.text.toLowerCase());
    }
  });

  it('drops Focus in practice mode, through the menu’s own rule', () => {
    expect(resolve(true).map((item) => item.spec.key)).toEqual(['loop', 'trainer', 'copy']);
  });

  it('resolves no editing command in play mode', () => {
    for (const { spec } of resolve()) {
      expect(registry.get(spec.command)?.context).not.toBe('editing');
    }
  });
});
