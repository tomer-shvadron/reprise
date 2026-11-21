import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { editHere } from './edit-here';
import { effectCommands, type EffectCommandId } from './effect-commands';
import { barCommands, type BarCommandId } from './bar-commands';
import { pickerCommands, toggleHistoryPanel, type PickerCommandId } from './picker-commands';
import { clipboardCommands, type ClipboardCommandId } from './clipboard-commands';
import { entryCommands, type EntryCommandId } from './entry-commands';
import { navigationCommands, type NavigationCommandId } from './navigation-commands';
import { wordCommands, type WordCommandId } from './word-commands';
import { trackEditCommands, type TrackEditCommandId } from './track-commands';
import { transposeCommands, type TransposeCommandId } from './transpose-commands';

export type EditorCommandId =
  | 'editor.toggleMode'
  | 'editor.showHistory'
  | 'editor.editHere'
  | NavigationCommandId
  | EntryCommandId
  | BarCommandId
  | TrackEditCommandId
  | EffectCommandId
  | PickerCommandId
  | ClipboardCommandId
  | TransposeCommandId
  | WordCommandId;

type EditorCommand = Command & { id: EditorCommandId };

/** The edit-mode toggle, the cursor commands, the note-entry keys, bar and track management and the clipboard. */
export function editorCommands(
  services: Pick<
    AppServices,
    | 'editing'
    | 'document'
    | 'selection'
    | 'layout'
    | 'entry'
    | 'playback'
    | 'audio'
    | 'ui'
    | 'menuTarget'
    | 'transport'
    | 'settings'
  >,
): EditorCommand[] {
  const { editing, document } = services;
  return [
    {
      id: 'editor.toggleMode',
      title: 'Toggle edit mode',
      shortcut: { key: 'e', mod: true },
      run: () => {
        if (document.getState().score) editing.getState().toggle();
      },
    },
    {
      id: 'editor.editHere',
      title: 'Edit here',
      // The menu's "Edit here" only; the palette has Toggle edit mode.
      inPalette: false,
      repeat: false,
      enabled: () => document.getState().score !== undefined && !editing.getState().editing,
      run: () => {
        editHere(services);
      },
    },
    {
      id: 'editor.showHistory',
      title: 'Show history',
      run: () => {
        toggleHistoryPanel(services.ui);
      },
    },
    ...navigationCommands(services),
    ...entryCommands(services),
    ...barCommands(services),
    ...trackEditCommands(services),
    ...effectCommands(services),
    ...pickerCommands(services),
    ...clipboardCommands(services),
    ...transposeCommands(services),
    ...wordCommands(services),
  ];
}
