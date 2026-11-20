import type { MenuContribution } from '../context-menu/types';

/**
 * "Focus on loop" on the surfaces that name bars (the score's range, and the loop toggle), and the
 * mode itself on the header's mode switch. The surfaces are wired to their triggers by #337.
 */
export const practiceMenus: readonly MenuContribution[] = [
  // Play mode only: it leaves edit mode, so an edit-mode range menu does not offer it.
  {
    surface: 'score.range',
    items: [{ command: 'view.focusOnLoop', group: 'practice', modes: ['play'] }],
  },
  { surface: 'transport.loop', items: [{ command: 'view.focusOnLoop', group: 'practice' }] },
  {
    surface: 'header',
    items: [
      {
        command: 'view.practiceMode',
        group: 'view',
        when: ({ target }) => target.kind === 'header' && target.element === 'mode',
      },
    ],
  },
];
