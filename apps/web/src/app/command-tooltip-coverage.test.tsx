import { act, cleanup, render, waitFor } from '@testing-library/react';
import { write } from '@reprise/formats';
import { fullScore } from '@reprise/model/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scaleOverlayFor } from '@/features/trainer/fretboard/scale-overlay';
import { stubViewport } from '@/features/score/test/viewport-stub';
import type { PanelView } from '@/state/ui';
import { modulating } from '@/test/two-sections';
import { createTestServices, fakePlatform } from '@/test/services';

import { App } from './app';
import type { CommandRegistry } from './command-registry';
import { SHORTCUT_OVERRIDES_SETTING } from './keymap';
import { bindingGroup } from './shortcut-table';
import { bindCommand, type RegisteredCommandId } from './use-command';

// The registry `App` builds, so a test can spy on every command's `run`.
const built: { registry?: CommandRegistry | undefined } = {};
vi.mock('./app-registry', async (original) => {
  const actual = await original<typeof import('./app-registry')>();
  return {
    ...actual,
    createAppRegistry: (...args: Parameters<typeof actual.createAppRegistry>) => {
      const registry = actual.createAppRegistry(...args);
      built.registry = registry;
      return registry;
    },
  };
});

type Scenario = {
  name: string;
  editing: boolean;
  practice?: boolean;
  panel?: PanelView;
  dock?: boolean;
  /** Marks a scale on the fretboard, which shows the chip with its Hide button. */
  scale?: boolean;
  /** Loops the first section from the strip, the one state where its button runs a command. */
  loop?: boolean;
  /** A song with a key, sections and a modulation, for the insights cards (`fullScore` has too few notes). */
  riff?: boolean;
};

// Each right-panel view and the dock once, in the modes that show different controls. A control
// that runs a command only in a state none of these opens would go unchecked: add the state here.
const SCENARIOS: readonly Scenario[] = [
  { name: 'play, mixer', editing: false, panel: 'mixer' },
  { name: 'play, practice tools', editing: false, panel: 'speedTrainer', dock: true },
  { name: 'play, tuner', editing: false, panel: 'tuner' },
  { name: 'play, metronome', editing: false, panel: 'metronome' },
  { name: 'play, history', editing: false, panel: 'history' },
  { name: 'play, chords', editing: false, panel: 'chords' },
  { name: 'play, song insights', editing: false, panel: 'insights', dock: true, riff: true },
  { name: 'play, scale overlay', editing: false, dock: true, scale: true },
  { name: 'edit, effects', editing: true, panel: 'effects', dock: true },
  { name: 'practice mode', editing: false, practice: true },
  { name: 'practice mode, section looped', editing: false, practice: true, loop: true },
];

const KEYS = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Every rebindable command to a key of its own, so that a control with no key today still shows one. */
function bindEverything(registry: CommandRegistry, ids: Iterable<string>) {
  return Object.fromEntries(
    [...ids]
      .filter((id) => registry.get(id)?.rebindable !== false && !registry.get(id)?.native)
      .map((id, at) => {
        const flags = (at % 7) + 1;
        return [
          id,
          {
            key: KEYS.charAt(Math.floor(at / 7) % KEYS.length),
            alt: Boolean(flags & 1),
            shift: Boolean(flags & 2),
            mod: Boolean(flags & 4),
          },
        ];
      }),
  );
}

async function mount(scenario: Scenario, bindAll = false) {
  stubViewport(1280, 800);
  const services = createTestServices({ platform: fakePlatform() });
  render(<App services={services} keyboard="mac" onMenuCommand={() => () => undefined} />);
  const { bytes } = await write(scenario.riff ? modulating() : fullScore(), 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('full.reprise', bytes);
  });
  act(() => {
    services.playback.setState({ song: { status: 'ready', error: undefined } });
    services.editing.getState().setEditing(scenario.editing);
    const ui = services.ui.getState();
    if (scenario.panel) ui.showPanelView(scenario.panel);
    if (scenario.dock) ui.showBottomPanelView('fretboard');
    if (scenario.practice) ui.enterPracticeMode('play');
    if (scenario.scale) scaleOverlayFor(services).getState().show(9, 'minorPentatonic', 'manual');
  });
  // The insights are analysed after the view opens; its cards hold the controls to check.
  if (scenario.panel === 'insights') {
    await waitFor(() => {
      expect(document.querySelector('[data-insight-card="scale"]')).not.toBeNull();
    });
  }
  if (scenario.loop) {
    act(() => {
      document.querySelector<HTMLElement>('[data-section]')?.click();
    });
  }
  const registry = built.registry;
  if (!registry) throw new Error('App did not build a registry');
  if (bindAll) {
    act(() => {
      services.settings.set(
        SHORTCUT_OVERRIDES_SETTING,
        bindEverything(
          registry,
          registry.list().map((command) => command.id),
        ),
      );
    });
  }
  return { services, registry };
}

const inChrome = (element: Element) =>
  element.closest('[role=menu],[role=dialog],[role=listbox],[role=tooltip]') === null;

function clickable(): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('button, [role=tab], [role=radio], [role=switch]'),
  ].filter(
    (element) =>
      inChrome(element) &&
      !(element as HTMLButtonElement).disabled &&
      element.getAttribute('aria-disabled') !== 'true' &&
      element.getAttribute('aria-haspopup') === null,
  );
}

const label = (element: Element) =>
  element.getAttribute('aria-label') ?? element.textContent.trim().slice(0, 40);

const proven = new Set<string>();

afterEach(cleanup);
beforeEach(() => {
  built.registry = undefined;
});

describe('command tooltip coverage', () => {
  for (const scenario of SCENARIOS) {
    it(`every command control states the registry's keys (${scenario.name}), before and after a rebind`, async () => {
      const { services, registry } = await mount(scenario);
      const expected = (id: string) =>
        bindCommand(
          { registry, keyboard: 'mac', editing: scenario.editing },
          id as RegisteredCommandId,
        ).ariaKeys;
      const check = () => {
        const tagged = [...document.querySelectorAll<HTMLElement>('[data-command-tooltip]')];
        expect(tagged.length).toBeGreaterThan(0);
        for (const element of tagged) {
          const id = element.dataset['commandTooltip'] ?? '';
          const control = element.matches('button,[role=tab],[role=radio],[role=switch]')
            ? element
            : (element.querySelector('[aria-keyshortcuts],button') ?? element);
          expect(control.getAttribute('aria-keyshortcuts') ?? undefined, id).toBe(expected(id));
        }
      };
      check();
      const rebound = new Set<string>();
      for (const element of document.querySelectorAll<HTMLElement>('[data-command-tooltip]')) {
        rebound.add(element.dataset['commandTooltip'] ?? '');
      }
      const overrides = bindEverything(registry, rebound);
      act(() => {
        services.settings.set(SHORTCUT_OVERRIDES_SETTING, overrides);
      });
      check();
    });

    it(`a control runs only the command its tooltip names (${scenario.name})`, async () => {
      await mount(scenario, true);
      const keyOf = (element: HTMLElement) =>
        `${label(element)}|${element.closest('[data-command-tooltip]')?.getAttribute('data-command-tooltip') ?? ''}`;
      // The same control (a track's Mute, a chord) proven in an earlier scenario is not clicked again.
      const todo = clickable()
        .map((element, at) => ({ at, key: keyOf(element) }))
        .filter(({ key }) => !proven.has(key));
      cleanup();
      const offenders: string[] = [];
      for (const { at, key } of todo) {
        built.registry = undefined;
        const { registry } = await mount(scenario, true);
        const target = clickable()[at];
        if (target && keyOf(target) === key) {
          const ran: string[] = [];
          for (const command of registry.list()) {
            command.run = () => {
              ran.push(command.id);
            };
          }
          const named = target
            .closest('[data-command-tooltip]')
            ?.getAttribute('data-command-tooltip');
          const group = (id: string) => {
            const command = registry.get(id);
            return command ? bindingGroup(command) : id;
          };
          act(() => {
            target.click();
          });
          const wrong = ran.filter(
            (id) => named === null || named === undefined || group(id) !== group(named),
          );
          if (wrong.length > 0) {
            offenders.push(
              `${key} ran ${wrong.join(', ')}${named ? '' : ' with no CommandTooltip'}`,
            );
          }
        }
        proven.add(key);
        cleanup();
      }
      expect(
        offenders,
        'controls that run a command other than the one their tooltip names',
      ).toEqual([]);
    }, 60_000);
  }
});
