import { write } from '@reprise/formats';
import { largeScore } from '@reprise/model/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PRACTICE_ZOOM_SETTING } from '@/state/app-settings';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';
import { createTestServices } from '@/test/services';

import { installPracticeMode } from './install-practice-mode';
import { enterPracticeMode } from './practice-mode';

async function setup(rows: [string, unknown][] = []) {
  const services = createTestServices();
  const settings = createTestSettings(createMemorySettingsBackend(rows));
  const deps = { ...services, settings };
  const stop = installPracticeMode(deps);
  await services.document
    .getState()
    .openBytes('song.reprise', (await write(largeScore(1, 4), 'reprise')).bytes);
  return { services, settings, deps, stop };
}

const announced = (services: Awaited<ReturnType<typeof setup>>['services']) =>
  services.transport.getState().announcement?.text;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('installPracticeMode', () => {
  it('writes no panel or dock setting across enter and leave', async () => {
    const { services, settings, deps, stop } = await setup();
    await settings.whenHydrated();
    const set = vi.spyOn(settings, 'set');
    enterPracticeMode(deps);
    services.ui.getState().leavePracticeMode();
    const keys = set.mock.calls.map(([definition]) => definition.key);
    expect(keys.filter((key) => key !== 'layout.practiceZoom')).toEqual([]);
    expect(services.ui.getState().practiceMode.on).toBe(false);
    stop();
  });

  it('applies the stored practice zoom, and writes a change back', async () => {
    const { services, settings, stop } = await setup([['layout.practiceZoom', 2]]);
    await settings.whenHydrated();
    expect(services.ui.getState().practiceZoom).toBe(2);
    services.ui.getState().setPracticeZoom(2.4);
    expect(settings.get(PRACTICE_ZOOM_SETTING)).toBe(2.4);
    stop();
  });

  it('keeps a zoom changed before the load over the stored row', async () => {
    const services = createTestServices();
    const settings = createTestSettings(createMemorySettingsBackend([['layout.practiceZoom', 2]]));
    const stop = installPracticeMode({ ...services, settings });
    services.ui.getState().setPracticeZoom(1.8);
    await settings.whenHydrated();
    expect(services.ui.getState().practiceZoom).toBe(1.8);
    expect(settings.get(PRACTICE_ZOOM_SETTING)).toBe(1.8);
    stop();
  });

  it('enters from Edit, leaves edit mode, and comes back to it on leaving', async () => {
    const { services, deps, stop } = await setup();
    services.editing.getState().setEditing(true);
    enterPracticeMode(deps);
    expect(services.editing.getState().editing).toBe(false);
    expect(services.ui.getState().practiceMode).toEqual({ on: true, returnTo: 'edit' });
    expect(announced(services)).toBe('Practice mode. Escape leaves.');

    services.ui.getState().leavePracticeMode();
    expect(services.editing.getState().editing).toBe(true);
    expect(announced(services)).toBe('Practice mode off.');
    stop();
  });

  it('returns to Play when it was entered from Play', async () => {
    const { services, deps, stop } = await setup();
    enterPracticeMode(deps);
    services.ui.getState().leavePracticeMode();
    expect(services.editing.getState().editing).toBe(false);
    stop();
  });

  it('does not enter without a score', () => {
    const services = createTestServices();
    const settings = createTestSettings();
    const stop = installPracticeMode({ ...services, settings });
    enterPracticeMode(services);
    expect(services.ui.getState().practiceMode.on).toBe(false);
    stop();
  });

  it('leaves when edit mode turns on, and does not bring edit back twice', async () => {
    const { services, deps, stop } = await setup();
    enterPracticeMode(deps);
    services.editing.getState().setEditing(true);
    expect(services.ui.getState().practiceMode.on).toBe(false);
    expect(services.editing.getState().editing).toBe(true);
    stop();
  });

  it('leaves when the document closes, and resets where Escape returns to on an open', async () => {
    const { services, deps, stop } = await setup();
    services.editing.getState().setEditing(true);
    enterPracticeMode(deps);
    await services.document
      .getState()
      .openBytes('other.reprise', (await write(largeScore(1, 4), 'reprise')).bytes);
    expect(services.ui.getState().practiceMode).toEqual({ on: true, returnTo: 'play' });

    services.document.getState().close();
    expect(services.ui.getState().practiceMode.on).toBe(false);
    expect(services.editing.getState().editing).toBe(false);
    stop();
  });
});
