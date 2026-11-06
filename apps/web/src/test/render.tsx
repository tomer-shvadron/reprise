import { render, type RenderResult } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AppServicesProvider } from '@/app/services-context';
import { TooltipProvider } from '@/components/ui/tooltip';

import { createTestServices } from './services';

/** Renders `ui` inside the providers the app gives it, over test services. */
export function renderWithServices(
  ui: ReactNode,
  services: ReturnType<typeof createTestServices> = createTestServices(),
): RenderResult & { services: ReturnType<typeof createTestServices> } {
  const result = render(
    <AppServicesProvider services={services}>
      <TooltipProvider>{ui}</TooltipProvider>
    </AppServicesProvider>,
  );
  return { ...result, services };
}
