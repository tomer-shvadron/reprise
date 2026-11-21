import { toggleLabel } from '@/app/context-menu/shell-menus';
import type { MenuContext, MenuContribution, MenuItemSpec } from '@/app/context-menu/types';

const hasScore = ({ services }: MenuContext) => services.document.getState().score !== undefined;
const play = ['play'] as const;
const edit = ['edit'] as const;

/** The editing commands carry `context: 'editing'`, so their items default to edit mode only. */
const clipboard: readonly MenuItemSpec[] = [
  { command: 'editor.copy', group: 'clipboard' },
  { command: 'editor.cut', group: 'clipboard' },
  { command: 'editor.paste', group: 'clipboard' },
];

/** Track management is global, not `editing`, so its items name edit mode themselves. */
const trackManagement: readonly MenuItemSpec[] = [
  { command: ['track.add', 'track.addWindows'], group: 'track', modes: edit },
  { command: 'track.moveUp', group: 'track', modes: edit },
  { command: 'track.moveDown', group: 'track', modes: edit },
  { command: 'track.remove', group: 'danger', modes: edit },
];

/**
 * The editor's items on the score's menus. In play mode each menu has one way into editing,
 * "Edit here", which switches the mode and acts on what was clicked; a play-mode menu never lists
 * an editing command. In edit mode the level's own items come flat and the levels above it become
 * the "Beat" and "Bar" submenus, so the menus stay short.
 */
export const editorMenus: readonly MenuContribution[] = [
  { surface: 'track.row', items: trackManagement },
  { surface: 'mixer.strip', items: trackManagement },
  {
    surface: 'score.note',
    items: [
      { command: 'editor.moveNoteUp', group: 'note' },
      { command: 'editor.moveNoteDown', group: 'note' },
      { command: 'editor.toggleTie', group: 'note' },
      { command: 'editor.nameChordFromNotes', group: 'note' },
      { command: 'editor.effect.hammerOn', group: 'effects' },
      { command: 'editor.effect.legatoSlide', group: 'effects' },
      { command: 'editor.effect.vibrato', group: 'effects' },
      { command: 'editor.effect.palmMute', group: 'effects' },
      { command: 'editor.effect.letRing', group: 'effects' },
      { command: 'editor.effect.deadNote', group: 'effects' },
      { command: 'editor.effect.ghostNote', group: 'effects' },
      { command: 'editor.effect.accent', group: 'effects' },
      { command: 'editor.effect.staccato', group: 'effects' },
      { command: 'editor.effect.bendPicker', group: 'effects' },
      { command: 'editor.effect.slidePicker', group: 'effects' },
      { command: 'editor.effect.harmonicPicker', group: 'effects' },
      { command: 'editor.effect.grace', group: 'effects' },
      ...clipboard,
      { command: 'editor.deleteNote', group: 'danger' },
    ],
  },
  {
    surface: 'score.beat',
    items: [
      { command: 'editor.insertBeat', group: 'beat' },
      { command: 'editor.rest', group: 'beat' },
      { command: 'editor.durationLonger', group: 'beat' },
      { command: 'editor.durationShorter', group: 'beat' },
      { command: 'editor.toggleDot', group: 'beat' },
      { command: 'editor.toggleTriplet', group: 'beat' },
      { command: 'editor.chordName', group: 'beat' },
      { command: 'editor.nameChordFromNotes', group: 'beat' },
      { command: 'editor.beatText', group: 'beat' },
      { command: 'editor.lyrics', group: 'beat' },
      { command: 'editor.editVoice1', group: 'beat' },
      { command: 'editor.editVoice2', group: 'beat' },
      { command: 'editor.effect.tremoloPicker', group: 'effects' },
      { command: 'editor.effect.brushDown', group: 'effects' },
      { command: 'editor.effect.brushUp', group: 'effects' },
      ...clipboard,
      {
        command: ['editor.deleteBeatMac', 'editor.deleteBeatWindows'],
        group: 'danger',
      },
    ],
  },
  {
    surface: 'score.bar',
    items: [
      { command: 'editor.copyBars', group: 'clipboard', modes: play, label: 'Copy bar' },
      { command: 'editor.editHere', group: 'edit', modes: play },
      {
        command: ['editor.insertBarBeforeMac', 'editor.insertBarBeforeWindows'],
        group: 'bar',
      },
      { command: 'editor.insertBarAfter', group: 'bar' },
      { command: 'editor.toggleRepeatStart', group: 'bar' },
      { command: 'editor.toggleRepeatEnd', group: 'bar' },
      { command: 'editor.repeatsAndEndings', group: 'bar' },
      { command: 'editor.directions', group: 'bar' },
      { command: 'editor.section', group: 'properties' },
      { command: 'editor.keySignature', group: 'properties' },
      { command: 'editor.tempoChange', group: 'properties' },
      { command: 'editor.transposeDialog', group: 'properties' },
      { command: 'editor.barProperties', group: 'properties' },
      ...clipboard,
      { command: ['editor.deleteBarsMac', 'editor.deleteBarsWindows'], group: 'danger' },
    ],
  },
  {
    surface: 'score.range',
    items: [
      { command: 'editor.copyBars', group: 'clipboard', modes: play, label: 'Copy bars' },
      { command: 'editor.editHere', group: 'edit', modes: play },
      ...clipboard,
      { command: 'editor.pasteInsert', group: 'clipboard' },
      { command: 'editor.pasteOverwrite', group: 'clipboard' },
      { command: 'editor.transposeUp', group: 'properties' },
      { command: 'editor.transposeDown', group: 'properties' },
      { command: 'editor.transposeDialog', group: 'properties' },
      { command: 'editor.clearSelection', group: 'edit' },
      {
        command: ['editor.deleteBarsMac', 'editor.deleteBarsWindows'],
        group: 'danger',
        when: ({ services }) => services.selection.getState().range?.kind === 'bars',
      },
    ],
  },
  {
    surface: 'score.section',
    items: [
      { command: 'editor.editHere', group: 'edit', modes: play, label: 'Edit section' },
      { command: 'editor.section', group: 'properties', label: 'Edit section…' },
      { command: 'editor.removeSection', group: 'danger' },
    ],
  },
  {
    surface: 'score.chord',
    items: [
      { command: 'editor.editHere', group: 'edit', modes: play, label: 'Edit chord name' },
      { command: 'editor.chordName', group: 'beat', label: 'Edit chord name…' },
      { command: 'editor.nameChordFromNotes', group: 'beat' },
      { command: 'editor.removeChordName', group: 'danger' },
    ],
  },
  {
    surface: 'score.paper',
    items: [
      {
        command: 'editor.toggleMode',
        group: 'edit',
        when: hasScore,
        label: ({ mode }) => (mode === 'edit' ? 'Play mode' : 'Edit mode'),
      },
      { command: 'editor.paste', group: 'clipboard' },
      { command: ['track.add', 'track.addWindows'], group: 'track', modes: edit },
      {
        command: 'editor.showHistory',
        group: 'properties',
        modes: edit,
        label: toggleLabel('history', 'history'),
      },
    ],
  },
];
