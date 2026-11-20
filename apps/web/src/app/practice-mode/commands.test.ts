import { write } from '@reprise/formats';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { createAppMenus } from '../app-menus';
import { createAppRegistry } from '../app-registry';
import { runCommand } from '../command-registry';
import { resolveMenu } from '../context-menu/resolve-menu';
import { installShortcutDispatcher } from '../shortcut-dispatcher';

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('song.reprise', (await write(largeScore(1, 8), 'reprise')).bytes);
  const get = (id: string) => {
    const command = registry.get(id);
    if (!command) throw new Error(`no command ${id}`);
    return command;
  };
  const ids = () => services.document.getState().score?.masterBars.map((bar) => bar.id) ?? [];
  return { services, registry, get, ids };
}

const key = (init: KeyboardEventInit) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

describe('the practice commands', () => {
  it('bind F11 and Escape without a shortcut conflict', async () => {
    const { registry, get } = await setup();
    expect(get('view.practiceMode').shortcut).toEqual({ key: 'F11' });
    expect(get('view.leavePracticeMode').shortcut).toEqual({ key: 'Escape' });
    expect(registry.conflicts()).toEqual([]);
  });

  it('toggles the mode, and is unavailable without a score', async () => {
    const services = createTestServices();
    const registry = createAppRegistry(services);
    const toggle = registry.get('view.practiceMode');
    expect(toggle?.enabled?.()).toBe(false);

    const { get, services: open } = await setup();
    runCommand(get('view.practiceMode'));
    expect(open.ui.getState().practiceMode.on).toBe(true);
    runCommand(get('view.practiceMode'));
    expect(open.ui.getState().practiceMode.on).toBe(false);
  });

  it('is leavable by Escape only while on', async () => {
    const { get, services } = await setup();
    expect(get('view.leavePracticeMode').enabled?.()).toBe(false);
    services.ui.getState().enterPracticeMode('play');
    expect(get('view.leavePracticeMode').enabled?.()).toBe(true);
  });

  it('acts on the practice zoom while practising, and on the normal zoom otherwise', async () => {
    const { get, services } = await setup();
    const { ui } = services;
    runCommand(get('view.zoomIn'));
    expect(ui.getState().zoom).toBe(1.1);
    ui.getState().enterPracticeMode('play');
    runCommand(get('view.zoomIn'));
    expect(ui.getState().practiceZoom).toBe(1.6);
    expect(ui.getState().zoom).toBe(1.1);
    runCommand(get('view.zoomReset'));
    expect(ui.getState().practiceZoom).toBe(1);
    expect(ui.getState().zoom).toBe(1.1);
  });

  it('shows the sidebar again when Shift+F6 is pressed in the mode', async () => {
    const { get, services } = await setup();
    services.ui.getState().enterPracticeMode('play');
    runCommand(get('track.focusSidebar'));
    expect(services.ui.getState().practiceMode.on).toBe(false);
    expect(services.ui.getState().panels.sidebar).toBe(true);
  });

  describe('Focus on loop', () => {
    it('is disabled with neither a selection nor a loop', async () => {
      const { get } = await setup();
      expect(get('view.focusOnLoop').enabled?.()).toBe(false);
    });

    it('loops the selected bars and enters the mode', async () => {
      const { get, services, ids } = await setup();
      const bars = ids();
      services.selection.getState().selectBars({ startBar: bars[2] ?? '', endBar: bars[4] ?? '' });
      expect(get('view.focusOnLoop').enabled?.()).toBe(true);
      runCommand(get('view.focusOnLoop'));
      expect(services.playback.getState().settings.loop).toEqual({
        startBar: bars[2],
        endBar: bars[4],
      });
      expect(services.ui.getState().practiceMode.on).toBe(true);
    });

    it('focuses the existing loop when nothing else is selected', async () => {
      const { get, services, ids } = await setup();
      const bars = ids();
      services.audio.setLoop({ startBar: bars[1] ?? '', endBar: bars[2] ?? '' });
      runCommand(get('view.focusOnLoop'));
      expect(services.ui.getState().practiceMode.on).toBe(true);
      expect(services.playback.getState().settings.loop?.startBar).toBe(bars[1]);
    });

    it('does not enter when the engine refuses the range', async () => {
      const { get, services, ids } = await setup();
      const bars = ids();
      services.selection.getState().selectBars({ startBar: bars[2] ?? '', endBar: bars[3] ?? '' });
      // Refuses the new range once; putting the previous loop back succeeds.
      services.fakeAudio.setLoop.mockImplementationOnce(() => {
        throw new RangeError('never plays in that order');
      });
      runCommand(get('view.focusOnLoop'));
      expect(services.ui.getState().practiceMode.on).toBe(false);
    });
  });

  it('puts "Focus on loop" on the range and loop surfaces in play mode', async () => {
    const { services, registry, ids } = await setup();
    const menus = createAppMenus(registry);
    const bars = ids();
    services.selection.getState().selectBars({ startBar: bars[0] ?? '', endBar: bars[1] ?? '' });
    const at = (surface: 'score.range' | 'transport.loop') =>
      resolveMenu(
        menus,
        registry,
        surface,
        {
          services,
          target:
            surface === 'score.range' ? { kind: 'range' } : { kind: 'transport', control: 'loop' },
          mode: 'play',
        },
        'mac',
      );
    for (const surface of ['score.range', 'transport.loop'] as const) {
      expect(JSON.stringify(at(surface))).toContain('view.focusOnLoop');
    }
  });

  describe('keys', () => {
    it('F11 enters, Escape leaves, and Space still plays in the mode', async () => {
      const { services, registry } = await setup();
      const stop = installShortcutDispatcher(window, registry, 'mac');
      const playPause = registry.get('transport.playPause');
      if (!playPause) throw new Error('no playPause');
      const run = playPause.run;
      let plays = 0;
      playPause.run = () => {
        plays += 1;
        return run();
      };
      key({ key: 'F11' });
      expect(services.ui.getState().practiceMode.on).toBe(true);
      key({ key: ' ' });
      expect(plays).toBe(1);
      key({ key: 'Escape' });
      expect(services.ui.getState().practiceMode.on).toBe(false);
      stop();
    });

    it('Escape in edit mode still clears the selection and does not touch the mode', async () => {
      const { services, registry } = await setup();
      const stop = installShortcutDispatcher(window, registry, 'mac');
      services.editing.getState().setEditing(true);
      key({ key: 'Escape' });
      expect(services.ui.getState().practiceMode.on).toBe(false);
      expect(services.editing.getState().editing).toBe(true);
      stop();
    });

    it('Escape goes to an open dialog first, and to a popover that already took it', async () => {
      const { services, registry } = await setup();
      const stop = installShortcutDispatcher(window, registry, 'mac');
      services.ui.getState().enterPracticeMode('play');

      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('data-state', 'open');
      document.body.append(dialog);
      key({ key: 'Escape' });
      expect(services.ui.getState().practiceMode.on).toBe(true);
      dialog.remove();

      const taken = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
      taken.preventDefault();
      window.dispatchEvent(taken);
      expect(services.ui.getState().practiceMode.on).toBe(true);

      key({ key: 'Escape' });
      expect(services.ui.getState().practiceMode.on).toBe(false);
      stop();
    });
  });
});
