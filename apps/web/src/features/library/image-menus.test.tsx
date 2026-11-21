import { midi, note, score } from '@reprise/model/testing';
import type { Score } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { createAppMenus } from '@/app/app-menus';
import { createAppRegistry } from '@/app/app-registry';
import { commandsIn, resolveMenu } from '@/app/context-menu/resolve-menu';
import type { MenuMode, MenuSurface } from '@/app/context-menu/types';
import type { MenuTarget } from '@/state/menu-target';
import { createTestServices } from '@/test/services';

function twoTracks(): Score {
  const builder = score().title('Mixed').track('guitar', { name: 'Lead' });
  builder.bar().beat('4', [note(1, 3)]);
  builder.track('drums', { name: 'Kit' });
  builder.bar().beat('4', [midi(36)]);
  return builder.build();
}

function setup() {
  const services = createTestServices();
  const built = twoTracks();
  services.document.setState({ score: built });
  services.selection.getState().reset(built.tracks[0]?.id);
  const registry = createAppRegistry(services);
  const menus = createAppMenus(registry);
  const [lead, kit] = built.tracks;
  const bar = built.masterBars[0];
  if (!lead || !kit || !bar) throw new Error('fixture');
  const resolve = (surface: MenuSurface, target: MenuTarget, mode: MenuMode) => {
    services.editing.getState().setEditing(mode === 'edit');
    services.menuTarget.getState().set(target);
    return commandsIn(resolveMenu(menus, registry, surface, { services, target, mode }, 'mac')).map(
      (command) => command.id,
    );
  };
  return { services, registry, bar, lead, kit, resolve };
}

describe('Copy as image on the score menus', () => {
  it('is on the range menu in both modes, so the selection pill menu inherits it', () => {
    const { services, bar, resolve } = setup();
    services.selection.getState().selectBars({ startBar: bar.id, endBar: bar.id });
    for (const mode of ['play', 'edit'] as const) {
      expect(resolve('score.range', { kind: 'range' }, mode)).toContain('edit.copyImage');
    }
  });

  it('is on a bar menu of any track, a drum track included', () => {
    const { bar, lead, kit, resolve } = setup();
    for (const track of [lead, kit]) {
      for (const mode of ['play', 'edit'] as const) {
        expect(
          resolve('score.bar', { kind: 'bar', masterBar: bar.id, track: track.id }, mode),
        ).toContain('edit.copyImage');
      }
    }
  });

  it('has palette commands with no default key, and Copy is disabled with no selection', () => {
    const { registry } = setup();
    for (const id of ['file.exportImage', 'edit.copyImage'] as const) {
      const command = registry.get(id);
      expect(command?.inPalette).not.toBe(false);
      expect(command?.shortcut).toBeUndefined();
    }
    expect(registry.get('file.exportImage')?.title).toBe('Export as image…');
    expect(registry.get('edit.copyImage')?.title).toBe('Copy as image');
    expect(registry.get('file.exportImage')?.enabled?.()).toBe(true);
    expect(registry.get('edit.copyImage')?.enabled?.()).toBe(false);
  });
});
