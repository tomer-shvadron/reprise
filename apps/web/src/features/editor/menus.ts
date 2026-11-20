import type { MenuContribution } from '@/app/context-menu/types';

const play = ['play'] as const;

/**
 * The editor's items on the score's menus. In play mode each menu has one way into editing,
 * "Edit here", which switches the mode and acts on what was clicked; a play-mode menu never lists
 * an editing command.
 */
export const editorMenus: readonly MenuContribution[] = [
  // The edit-mode items of a note's menu come with the edit-mode menus; its play-mode items are its beat's and bar's.
  { surface: 'score.note', items: [] },
  { surface: 'score.beat', items: [] },
  {
    surface: 'score.bar',
    items: [
      { command: 'editor.copyBars', group: 'clipboard', modes: play, label: 'Copy bar' },
      { command: 'editor.editHere', group: 'edit', modes: play },
    ],
  },
  {
    surface: 'score.range',
    items: [
      { command: 'editor.copyBars', group: 'clipboard', modes: play, label: 'Copy bars' },
      { command: 'editor.editHere', group: 'edit', modes: play },
    ],
  },
  {
    surface: 'score.section',
    items: [{ command: 'editor.editHere', group: 'edit', modes: play, label: 'Edit section' }],
  },
  {
    surface: 'score.chord',
    items: [{ command: 'editor.editHere', group: 'edit', modes: play, label: 'Edit chord name' }],
  },
  {
    surface: 'score.paper',
    items: [{ command: 'editor.toggleMode', group: 'edit', modes: play, label: 'Edit mode' }],
  },
];
