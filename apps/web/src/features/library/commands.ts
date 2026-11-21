import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import { whenSaved } from '@/app/when-saved';

import { libraryOf } from './library';

export type LibraryCommandId =
  | 'library.show'
  | 'library.importFiles'
  | 'library.importFolder'
  | 'library.openWithoutImport'
  | 'library.openRecent'
  | 'library.openSong'
  | 'library.showPracticeLog'
  | 'library.deleteSong';

type LibraryCommand = Command & { id: LibraryCommandId };

export function libraryCommands(services: AppServices): LibraryCommand[] {
  const { ui } = services;
  // Each run shows the library first: the progress and the summary are on its sheet.
  const importing = (run: () => Promise<void>) => () => {
    ui.getState().showSheet('library');
    return run();
  };
  // The row a menu was opened on. The commands that need one are for the row menus alone.
  const targetSong = () => {
    const target = services.menuTarget.getState().target;
    return target?.kind === 'libraryEntry' ? target.id : undefined;
  };
  const onRow = () => services.menuTarget.getState().target?.kind === 'libraryEntry';
  return [
    {
      id: 'library.show',
      title: 'Show library',
      run: () => {
        ui.getState().showSheet('library');
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
    {
      id: 'library.openSong',
      title: 'Open song',
      inPalette: false,
      enabled: onRow,
      run: () => {
        const id = targetSong();
        if (id !== undefined) void libraryOf(services).requestOpenSong(id);
      },
    },
    {
      id: 'library.showPracticeLog',
      title: 'Show practice log',
      inPalette: false,
      enabled: onRow,
      run: () => {
        const id = targetSong();
        if (id !== undefined) libraryOf(services).store.setState({ practiceLogId: id });
      },
    },
    {
      id: 'library.deleteSong',
      title: 'Delete from library…',
      inPalette: false,
      enabled: onRow,
      run: () => {
        const id = targetSong();
        if (id !== undefined) libraryOf(services).store.setState({ deleteId: id });
      },
    },
  ];
}
