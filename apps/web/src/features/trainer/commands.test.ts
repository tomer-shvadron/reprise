import { write } from '@reprise/formats';
import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import { runCommand } from '@/app/command-registry';
import { installShortcutDispatcher } from '@/app/shortcut-dispatcher';
import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';

import { speedTrainerFor } from './speed-trainer/speed-trainer-for';
import { tunerFor } from './tuner/tuner-for';

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const { bytes } = await write(fourBars(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const first = services.document.getState().score?.masterBars[0];
  if (!first) throw new Error('no bar');
  const loop = () => {
    services.fakeAudio.setLoop({ startBar: first.id, endBar: first.id });
  };
  return { services, registry, loop, trainer: speedTrainerFor(services) };
}

describe('trainer commands', () => {
  it('list in the palette with their titles and shortcuts', async () => {
    const { registry } = await setup();
    const find = (id: string) => registry.get(id);
    expect(find('trainer.speedTrainerToggle')).toMatchObject({
      title: 'Start, hold or resume speed trainer',
      shortcut: { key: 's', alt: true },
    });
    expect(find('trainer.speedTrainerMissed')).toMatchObject({
      title: 'Mark speed trainer pass missed',
      shortcut: { key: 'x', alt: true },
    });
    expect(find('trainer.speedTrainerReset')).toMatchObject({
      title: 'Reset speed trainer',
      shortcut: { key: 's', alt: true, shift: true },
    });
    expect(find('trainer.speedTrainer')?.shortcut).toBeUndefined();
    expect(find('trainer.tunerToggle')).toMatchObject({ title: 'Start or stop tuner' });
    expect(find('trainer.tunerToggle')?.shortcut).toBeUndefined();
  });

  it('the tuner toggle shows the panel and flips whether the tuner is wanted', async () => {
    const { services, registry } = await setup();
    await registry.get('trainer.tunerToggle')?.run();
    expect(services.ui.getState().rightPanelView).toBe('tuner');
    expect(tunerFor(services).getState().wanted).toBe(true);
    await registry.get('trainer.tunerToggle')?.run();
    expect(tunerFor(services).getState().wanted).toBe(false);
  });

  it('toggle shows the panel, starts, holds and resumes', async () => {
    const { services, registry, loop, trainer } = await setup();
    loop();
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    expect(trainer.getState().status).toBe('running');
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(trainer.getState().status).toBe('held');
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(trainer.getState().status).toBe('running');
  });

  it('toggle with no loop only shows the panel and says why', async () => {
    const { services, registry, trainer } = await setup();
    await registry.get('trainer.speedTrainerToggle')?.run();
    expect(trainer.getState().status).toBe('idle');
    expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    expect(services.transport.getState().announcement?.text).toBe('Loop some bars first');
  });

  it('missed and reset act on a run', async () => {
    const { registry, loop, trainer } = await setup();
    loop();
    await registry.get('trainer.speedTrainerMissed')?.run();
    expect(trainer.getState().missed).toBe(false);
    await registry.get('trainer.speedTrainerToggle')?.run();
    await registry.get('trainer.speedTrainerMissed')?.run();
    expect(trainer.getState().missed).toBe(true);
    await registry.get('trainer.speedTrainerReset')?.run();
    expect(trainer.getState().status).toBe('idle');
  });

  it('run from the keyboard, by physical key under the Option dead keys on macOS', async () => {
    const { registry, loop, trainer } = await setup();
    loop();
    const uninstall = installShortcutDispatcher(window, registry, 'mac');
    try {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ß', code: 'KeyS', altKey: true, cancelable: true }),
      );
      expect(trainer.getState().status).toBe('running');
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: '≈', code: 'KeyX', altKey: true, cancelable: true }),
      );
      expect(trainer.getState().missed).toBe(true);
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Í',
          code: 'KeyS',
          altKey: true,
          shiftKey: true,
          cancelable: true,
        }),
      );
      expect(trainer.getState().status).toBe('idle');
    } finally {
      uninstall();
    }
  });

  describe('in the practice mode', () => {
    it('start the trainer, the click and the tuner without opening a panel or leaving', async () => {
      const { services, registry, loop, trainer } = await setup();
      loop();
      services.ui.getState().enterPracticeMode('play');
      const run = (id: string) => {
        const command = registry.get(id);
        if (!command) throw new Error(`no command ${id}`);
        runCommand(command);
      };
      run('trainer.speedTrainerToggle');
      expect(trainer.getState().status).toBe('running');
      run('trainer.metronomeToggle');
      expect(services.fakeAudio.startClick).toHaveBeenCalled();
      run('trainer.tunerToggle');
      expect(services.ui.getState().practiceMode.on).toBe(true);
      expect(services.ui.getState().panels.rightPanel).toBe(false);
    });

    it('still leave the mode and show the panel for the explicit Show commands', async () => {
      const { services, registry } = await setup();
      services.ui.getState().enterPracticeMode('play');
      const show = registry.get('trainer.speedTrainer');
      if (show) runCommand(show);
      expect(services.ui.getState().practiceMode.on).toBe(false);
      expect(services.ui.getState().rightPanelView).toBe('speedTrainer');
    });
  });
});
