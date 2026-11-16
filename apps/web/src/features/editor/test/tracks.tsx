import type { Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { act, type RenderResult } from '@testing-library/react';

import { createAppRegistry } from '@/app/app-registry';
import type { CommandRegistry } from '@/app/command-registry';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { EditorDialogs } from '../editor-dialogs';

export type TestServices = ReturnType<typeof createTestServices>;

/** A Lead guitar with notes in both bars, an empty Bass and an empty Drums track. */
export function bandScore(): Score {
  const built = score().track('guitar', { name: 'Lead', tuning: [35, 40, 45, 50, 55, 59, 64] });
  built
    .bar()
    .beat('4', [note(1, 3)])
    .beat('4', [note(7, 2)]);
  built.bar().beat('4', [note(6, 5)]);
  built.track('bass', { name: 'Bass' });
  built.track('drums', { name: 'Drums' });
  return built.build();
}

export function setupTracks(built: Score = bandScore()): RenderResult & {
  services: TestServices;
  registry: CommandRegistry;
  ids: string[];
  /** Runs a registered command inside `act`. */
  run: (id: string) => void;
} {
  const services = createTestServices();
  const registry = createAppRegistry(services);
  const result = renderWithServices(<EditorDialogs />, services);
  act(() => {
    services.document.getState().newDocument(built);
  });
  const ids = services.document.getState().score?.tracks.map((track) => track.id) ?? [];
  const run = (id: string) => {
    const command = registry.get(id);
    if (!command) throw new Error(`no command ${id}`);
    act(() => {
      void command.run();
    });
  };
  return { ...result, services, registry, ids, run };
}

export const tracksOf = (services: TestServices) =>
  services.document.getState().score?.tracks ?? [];
