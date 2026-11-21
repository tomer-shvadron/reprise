import { beforeAll, describe, expect, it } from 'vitest';

import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';
import type { MenuTarget } from '@/state/menu-target';
import { PANEL_TABS } from '../right-panel/panel-views';

import { createAppMenus } from '../app-menus';
import { createAppRegistry } from '../app-registry';
import { commandsIn, resolveMenu, type ResolvedEntry } from './resolve-menu';
import { MENU_SURFACES, type MenuMode, type MenuSurface } from './types';

const services = createTestServices();
const song = fourBars();
services.document.setState({ score: song });
const registry = createAppRegistry(services);
const menus = createAppMenus(registry);

/**
 * The surfaces nobody has contributed to yet, each of which a later PR of #337 removes from here
 * when it adds its items: the test below then holds the new surface to the same rules.
 */
const NOT_YET: readonly MenuSurface[] = ['status.segment', 'library.song', 'sounds.pack'];

const bar = song.masterBars[1];
const beat = song.tracks[0]?.bars[1]?.voices[0]?.beats[1];
const noted = beat?.notes[0];
const track = song.tracks[0];
if (!bar || !beat || !noted || !track) throw new Error('the fixture song changed');
const found = { beat: beat.id, track: track.id, masterBar: bar.id };

/** A representative target per contributed surface, with every variant its `when`s tell apart. */
const TARGETS: Partial<Record<MenuSurface, readonly MenuTarget[]>> = {
  'score.note': [{ kind: 'note', note: noted.id, ...found }],
  'score.beat': [{ kind: 'beat', ...found }],
  'score.bar': [{ kind: 'bar', masterBar: bar.id, track: track.id }],
  'score.range': [{ kind: 'range' }],
  'score.section': [{ kind: 'section', masterBar: bar.id }],
  'score.chord': [{ kind: 'chord', ...found }],
  'score.paper': [{ kind: 'paper' }],
  header: (['crumb', 'mode', 'view', 'search', 'band'] as const).map((element) => ({
    kind: 'header',
    element,
  })),
  'panel.tab': PANEL_TABS.map(({ view }) => ({ kind: 'panel', view })),
  // "Focus on loop" needs bars to focus on: `beforeAll` selects one.
  'transport.loop': [{ kind: 'transport', control: 'loop' }],
  'transport.tempo': [{ kind: 'transport', control: 'tempo' }],
  'transport.countIn': [{ kind: 'transport', control: 'countIn' }],
  'transport.metronome': [{ kind: 'transport', control: 'metronome' }],
  'track.row': [{ kind: 'track', track: track.id }],
  'mixer.strip': [{ kind: 'track', track: track.id }],
  'mixer.master': [{ kind: 'mixerMaster' }],
  'dock.tab': [{ kind: 'dock', view: 'fretboard' }],
  fretboard: [{ kind: 'dock', view: 'fretboard' }],
  'panel.rail': [
    ...PANEL_TABS.map(({ view }): MenuTarget => ({ kind: 'panel', view })),
    { kind: 'panel', view: undefined },
  ],
};

const MODES: readonly MenuMode[] = ['play', 'edit'];

const enabledItems = (entries: readonly ResolvedEntry[]): number =>
  entries.reduce(
    (count, entry) =>
      count +
      (entry.kind === 'item'
        ? Number(entry.enabled)
        : entry.kind === 'submenu'
          ? enabledItems(entry.entries)
          : 0),
    0,
  );

function resolveFor(surface: MenuSurface, target: MenuTarget, mode: MenuMode) {
  services.editing.getState().setEditing(mode === 'edit');
  return resolveMenu(menus, registry, surface, { services, target, mode }, 'mac');
}

describe('the context menus', () => {
  beforeAll(() => {
    services.selection.getState().selectBars({ startBar: bar.id, endBar: bar.id });
  });

  it('name only registered commands, and no editing command in play mode', () => {
    for (const surface of menus.surfaces()) {
      for (const item of menus.itemsOf(surface)) {
        for (const id of item.commands) {
          const command = registry.get(id);
          expect(command, `${surface} names ${id}`).toBeDefined();
          if (command?.context === 'editing') {
            expect(item.modes, `${surface} lists ${id}`).not.toContain('play');
          }
        }
      }
    }
  });

  it('cover every surface except those a later PR still owes', () => {
    const contributed = new Set(menus.surfaces());
    const missing = MENU_SURFACES.filter((surface) => !contributed.has(surface));
    expect(missing).toEqual(NOT_YET);
  });

  it('hold every contributed surface to the rules below, so a PR that adds one adds its targets', () => {
    expect(Object.keys(TARGETS).sort()).toEqual([...menus.surfaces()].sort());
  });

  it.each(Object.entries(TARGETS) as [MenuSurface, readonly MenuTarget[]][])(
    '%s resolves an enabled item for each target in each mode',
    (surface, targets) => {
      for (const target of targets) {
        for (const mode of MODES) {
          const enabled = enabledItems(resolveFor(surface, target, mode));
          expect(enabled, `${surface} ${JSON.stringify(target)} in ${mode}`).toBeGreaterThan(0);
        }
      }
    },
  );

  it('offer no editing command in play mode, submenus included', () => {
    for (const [surface, targets] of Object.entries(TARGETS) as [
      MenuSurface,
      readonly MenuTarget[],
    ][]) {
      for (const target of targets) {
        const commands = commandsIn(resolveFor(surface, target, 'play'));
        expect(commands.filter((command) => command.context === 'editing')).toEqual([]);
      }
    }
  });
});
