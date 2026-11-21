import type { Score } from '@reprise/model';
import { midi, note, score } from '@reprise/model/testing';
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

describe('Copy as ASCII tab on the score menus', () => {
  it('is on the range menu in both modes, so the selection pill menu inherits it', () => {
    const { services, bar, resolve } = setup();
    services.selection.getState().selectBars({ startBar: bar.id, endBar: bar.id });
    for (const mode of ['play', 'edit'] as const) {
      expect(resolve('score.range', { kind: 'range' }, mode)).toContain('score.copyAsciiTab');
    }
  });

  it('is on a bar menu, and hidden when the bar is a drum track', () => {
    const { bar, lead, kit, resolve } = setup();
    const on = (track: typeof lead, mode: MenuMode) =>
      resolve('score.bar', { kind: 'bar', masterBar: bar.id, track: track.id }, mode);
    expect(on(lead, 'play')).toContain('score.copyAsciiTab');
    expect(on(lead, 'edit')).toContain('score.copyAsciiTab');
    expect(on(kit, 'play')).not.toContain('score.copyAsciiTab');
    expect(on(kit, 'edit')).not.toContain('score.copyAsciiTab');
  });

  it('is hidden on a range whose only track is a drum track', () => {
    const { services, bar, kit, resolve } = setup();
    services.selection.getState().setCurrentTrack(kit.id);
    services.selection.getState().selectBars({ startBar: bar.id, endBar: bar.id });
    expect(resolve('score.range', { kind: 'range' }, 'play')).not.toContain('score.copyAsciiTab');
  });

  it('has a command in the palette for each of the two, with no default key', () => {
    const { registry } = setup();
    for (const id of ['file.exportAsciiTab', 'score.copyAsciiTab'] as const) {
      const command = registry.get(id);
      expect(command?.inPalette).not.toBe(false);
      expect(command?.shortcut).toBeUndefined();
    }
    expect(registry.get('file.exportAsciiTab')?.title).toBe('Export as ASCII tab…');
    expect(registry.get('score.copyAsciiTab')?.title).toBe('Copy as ASCII tab');
  });
});
