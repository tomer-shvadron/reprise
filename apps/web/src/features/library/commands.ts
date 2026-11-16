import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import { whenSaved } from '@/app/when-saved';

import { libraryOf } from './library';

export type LibraryCommandId =
  | 'library.show'
  | 'library.importFiles'
  | 'library.importFolder'
  | 'library.openWithoutImport'
  | 'library.openRecent';

type LibraryCommand = Command & { id: LibraryCommandId };

export function libraryCommands(services: AppServices): LibraryCommand[] {
  const { ui } = services;
  // Each run shows the library first: the progress and the summary are on its screen.
  const importing = (run: () => Promise<void>) => () => {
    ui.getState().setScreen('library');
    return run();
  };
  return [
    {
      id: 'library.show',
      title: 'Show library',
      run: () => {
        ui.getState().setScreen('library');
      },
    },
    {
      id: 'library.importFiles',
      title: 'Import files to library…',
      run: importing(() => libraryOf(services).importFiles()),
    },
    {
      id: 'library.importFolder',
      title: 'Import folder to library…',
      run: importing(() => libraryOf(services).importFolder()),
    },
    {
      id: 'library.openWithoutImport',
      title: 'Open without importing…',
      run: () => {
        whenSaved(services, 'opening another song', () => {
          void libraryOf(services).openFileWithoutImport();
        });
      },
    },
    {
      id: 'library.openRecent',
      title: 'Open recent song…',
      run: () => {
        libraryOf(services).showRecent();
      },
    },
  ];
}
