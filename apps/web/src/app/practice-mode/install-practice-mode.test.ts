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

  it('gives focus back to the chrome control it left, and parks it on the score meanwhile', async () => {
    const { services, deps, stop } = await setup();
    const region = globalThis.document.createElement('main');
    region.tabIndex = -1;
    const control = globalThis.document.createElement('button');
    globalThis.document.body.append(region, control);
    const frames = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    control.focus();
    enterPracticeMode(deps);
    // What a browser does when the focused element turns inert.
    control.blur();
    await frames();
    expect(globalThis.document.activeElement).toBe(region);

    services.ui.getState().leavePracticeMode();
    await frames();
    await frames();
    expect(globalThis.document.activeElement).toBe(control);
    region.remove();
    control.remove();
    stop();
  });

  it('finds the remounted control by role and label, and falls back to the score', async () => {
    const { services, deps, stop } = await setup();
    const region = globalThis.document.createElement('main');
    region.tabIndex = -1;
    const slider = (label: string) => {
      const element = globalThis.document.createElement('span');
      element.setAttribute('role', 'slider');
      element.setAttribute('aria-label', label);
      element.tabIndex = 0;
      return element;
    };
    const old = slider('Volume of Lead');
    globalThis.document.body.append(region, old);
    const frames = async () => {
      for (let i = 0; i < 3; i += 1) await new Promise((resolve) => requestAnimationFrame(resolve));
    };
    old.focus();
    enterPracticeMode(deps);
    old.remove();
    const remounted = slider('Volume of Lead');
    globalThis.document.body.append(remounted);
    // A panel taking focus on mount, as `focusPanelSection` does.
    const section = globalThis.document.createElement('section');
    section.tabIndex = -1;
    globalThis.document.body.append(section);
    services.ui.getState().leavePracticeMode();
    section.focus();
    await frames();
    expect(globalThis.document.activeElement).toBe(remounted);

    remounted.focus();
    enterPracticeMode(deps);
    remounted.remove();
    services.ui.getState().leavePracticeMode();
    await frames();
    expect(globalThis.document.activeElement).toBe(region);
    region.remove();
    section.remove();
    stop();
  });

  it('does not move focus to the score after an entry from the body', async () => {
    const { deps, stop } = await setup();
    const region = globalThis.document.createElement('main');
    region.tabIndex = -1;
    globalThis.document.body.append(region);
    enterPracticeMode(deps);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(globalThis.document.activeElement).toBe(globalThis.document.body);
    region.remove();
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
