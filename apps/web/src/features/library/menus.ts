import type { MenuContext, MenuContribution } from '@/app/context-menu/types';

import { asciiScopeOf, hasFrettedTrack, imageScopeOf } from './save/ascii-scope';

/** Hidden when everything the menu would copy is a drum or pitched track, which has no strings. */
const copyable = ({ services, target }: MenuContext) => {
  const { score } = services.document.getState();
  if (!score) return false;
  const scope = asciiScopeOf(
    score,
    services.selection.getState(),
    target,
    services.document.getState().view,
  );
  return scope !== undefined && hasFrettedTrack(score, scope.tracks);
};

/** Anything selected can be copied as an image, strings or not. */
const selected = ({ services, target }: MenuContext) => {
  const { score, view } = services.document.getState();
  return (
    score !== undefined &&
    imageScopeOf(score, services.selection.getState(), target, view) !== undefined
  );
};

/**
 * The library sheet's song row, and Copy as ASCII tab and Copy as image on the score's bar and
 * range menus.
 */
export const libraryMenus: readonly MenuContribution[] = [
  {
    surface: 'score.range',
    items: [
      { command: 'edit.copyAsciiTab', group: 'export', when: copyable },
      { command: 'edit.copyImage', group: 'export', when: selected },
    ],
  },
  {
    surface: 'score.bar',
    items: [
      {
        command: 'edit.copyAsciiTab',
        group: 'export',
        label: 'Copy bar as ASCII tab',
        when: copyable,
      },
      { command: 'edit.copyImage', group: 'export', label: 'Copy bar as image', when: selected },
    ],
  },
  {
    surface: 'library.song',
    items: [
      { command: 'library.openSong', group: 'play', label: 'Open' },
      { command: 'library.showPracticeLog', group: 'view', label: 'Practice log' },
      { command: 'library.deleteSong', group: 'danger' },
    ],
  },
];
