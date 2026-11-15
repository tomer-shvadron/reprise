import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

export type LibraryCommandId = 'library.show';

type LibraryCommand = Command & { id: LibraryCommandId };

export function libraryCommands(services: Pick<AppServices, 'ui'>): LibraryCommand[] {
  const { ui } = services;
  return [
    {
      id: 'library.show',
      title: 'Show library',
      run: () => {
        ui.getState().setScreen('library');
      },
    },
  ];
}
