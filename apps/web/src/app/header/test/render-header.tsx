import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import { createAppRegistry } from '@/app/app-registry';
import type { CommandRegistry } from '@/app/command-registry';
import { AppServicesProvider } from '@/app/services-context';
import { CommandSourceContext } from '@/app/use-command';
import { TooltipProvider } from '@/components/ui/tooltip';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

/** Spies on a registered command's `run`, which proves a control runs the registry's command. */
export function spyOnCommand(registry: CommandRegistry, id: string) {
  const command = registry.get(id);
  if (!command) throw new Error(`no command ${id}`);
  return vi.spyOn(command, 'run');
}

export function riff(): Score {
  return score()
    .track('guitar', { name: 'Lead', program: 30 })
    .track('drums', { name: 'Drums' })
    .build();
}

/** Renders `ui` over test services, a registry and the providers the header sits in. */
export function renderHeader(ui: ReactNode): RenderResult & {
  services: ReturnType<typeof createTestServices>;
  registry: CommandRegistry;
  open: (song?: Score) => Promise<void>;
} {
  const services = createTestServices();
  mirrorAudio(services);
  const registry = createAppRegistry(services);
  const result = render(
    <AppServicesProvider services={services}>
      <TooltipProvider>
        <CommandSourceContext value={{ registry, keyboard: 'mac' }}>{ui}</CommandSourceContext>
      </TooltipProvider>
    </AppServicesProvider>,
  );
  const open = async (song: Score = riff()) => {
    const { bytes } = await write(song, 'reprise');
    await act(async () => {
      await services.document.getState().openBytes('song.reprise', bytes);
    });
  };
  return { ...result, services, registry, open };
}
