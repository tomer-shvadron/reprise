import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createAppRegistry } from '@/app/app-registry';
import { CommandSourceContext } from '@/app/use-command';
import { dispatchShortcut } from '@/app/shortcut-dispatcher';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { cursorAtPosition } from '../cursor';
import { EditorDialogs } from '../editor-dialogs';

/** A fretted riff: a note on string 1 then 2, a chord, a note, and a second bar. */
export function riff(): Score {
  const built = score().track('guitar');
  built
    .bar()
    .beat('4', [note(1, 5)])
    .beat('4', [note(2, 7), note(3, 0)])
    .beat('4', [note(1, 9)])
    .beat('4', [note(4, 2)]);
  built.bar().beat('1', [note(1, 3)]);
  return built.build({ ids: 'sequential' });
}

/** Services in edit mode on `built`, with the registry, the dialog host and an optional panel. */
export async function setupEffects(panel?: ReactNode, built: Score = riff()) {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  await services.document
    .getState()
    .openBytes('effects.reprise', (await write(built, 'reprise')).bytes);
  services.editing.getState().setEditing(true);
  const source = { registry, keyboard: 'other' as const };
  renderWithServices(
    <CommandSourceContext value={source}>
      {panel}
      <EditorDialogs />
    </CommandSourceContext>,
    services,
  );
  const goTo = (stop: number, string = 1, bar = 0) => {
    const current = services.document.getState().score;
    if (!current) throw new Error('not open');
    const cursor = cursorAtPosition(
      current,
      { track: 0, bar, voice: 0, stop },
      { string, staff: 'tab' },
    );
    act(() => {
      services.selection.getState().setEdit({ cursor, currentTrack: cursor?.track });
    });
  };
  goTo(0);
  const press = (key: string, init: KeyboardEventInit = {}) => {
    let handled = false;
    act(() => {
      handled = dispatchShortcut(
        new KeyboardEvent('keydown', { key, cancelable: true, ...init }),
        registry,
        'other',
      );
    });
    return handled;
  };
  const beats = (bar = 0) =>
    services.document.getState().score?.tracks[0]?.bars[bar]?.voices[0]?.beats ?? [];
  return { services, registry, goTo, press, beats };
}
