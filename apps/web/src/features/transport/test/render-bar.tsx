import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { act, type RenderResult } from '@testing-library/react';

import { createAppRegistry } from '@/app/app-registry';
import type { CommandRegistry } from '@/app/command-registry';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { TransportBar } from '../transport-bar';
import { mirrorAudio } from './mirror-audio';

type TestServices = ReturnType<typeof createTestServices>;

/** The bar over test services whose fake audio mirrors its settings into the store. */
export function renderBar(registry?: (services: TestServices) => CommandRegistry): RenderResult & {
  services: TestServices;
  registry: CommandRegistry;
  open: (song: Score, name?: string) => Promise<void>;
} {
  const services = createTestServices();
  mirrorAudio(services);
  const commands = registry ? registry(services) : createAppRegistry(services);
  const result = renderWithServices(<TransportBar registry={commands} keyboard="mac" />, services);
  const open = async (song: Score, name = 'song.reprise') => {
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes(name, bytes);
    });
    act(() => {
      services.playback.setState({ song: { status: 'ready', error: undefined } });
    });
  };
  return { ...result, services, registry: commands, open };
}
