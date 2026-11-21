import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { createAppMenus } from '@/app/app-menus';
import { createAppRegistry } from '@/app/app-registry';
import { MenuRegistryContext } from '@/app/context-menu/menu-context';
import { AppServicesProvider } from '@/app/services-context';
import { CommandSourceContext } from '@/app/use-command';
import { TooltipProvider } from '@/components/ui/tooltip';

import { createTestServices } from './services';

/** Renders `ui` inside the providers the app gives it, over test services. */
export function renderWithServices(
  ui: ReactNode,
  services: ReturnType<typeof createTestServices> = createTestServices(),
): RenderResult & { services: ReturnType<typeof createTestServices> } {
  // The menus a surface that mirrors menu items (the selection pill) reads, as `App` provides them.
  const registry = createAppRegistry(services, 'other');
  const menus = { menus: createAppMenus(registry), registry, keyboard: 'other' as const };
  const result = render(
    <AppServicesProvider services={services}>
      <MenuRegistryContext value={menus}>
        <CommandSourceContext value={{ registry, keyboard: 'other' }}>
          <TooltipProvider>{ui}</TooltipProvider>
        </CommandSourceContext>
      </MenuRegistryContext>
    </AppServicesProvider>,
  );
  return { ...result, services };
}
