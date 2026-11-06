import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createAppRegistry } from '@/app/app-registry';
import type { CommandRegistry } from '@/app/command-registry';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

export type TestServices = ReturnType<typeof createTestServices>;

/** Lead (guitar, Distortion Guitar), Bass, and Drums on the standard kit. */
export function threeTracks(): Score {
  return score()
    .track('guitar', { name: 'Lead', program: 30 })
    .track('bass', { name: 'Bass' })
    .track('drums', { name: 'Drums' })
    .build();
}

export function renderTracks(ui: (registry: CommandRegistry) => ReactNode): RenderResult & {
  services: TestServices;
  registry: CommandRegistry;
  /** Opens the song and returns its track ids. */
  open: (song?: Score) => Promise<string[]>;
} {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const result = renderWithServices(ui(registry), services);
  const open = async (song: Score = threeTracks()) => {
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
    return services.document.getState().score?.tracks.map((track) => track.id) ?? [];
  };
  return { ...result, services, registry, open };
}
