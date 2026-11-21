import type { MenuContribution } from '@/app/context-menu/types';

/** The library sheet's song row. */
export const libraryMenus: readonly MenuContribution[] = [
  {
    surface: 'library.song',
    items: [
      { command: 'library.openSong', group: 'play', label: 'Open' },
      { command: 'library.showPracticeLog', group: 'view', label: 'Practice log' },
      { command: 'library.deleteSong', group: 'danger' },
    ],
  },
];
