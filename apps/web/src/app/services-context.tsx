import { createContext, use, type ReactNode } from 'react';

import type { AppServices } from './services';

const ServicesContext = createContext<AppServices | undefined>(undefined);

export function AppServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

export function useAppServices(): AppServices {
  const services = use(ServicesContext);
  if (!services) throw new Error('useAppServices needs an AppServicesProvider');
  return services;
}
