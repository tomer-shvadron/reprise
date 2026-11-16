import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { entryCommands, type EntryCommandId } from './entry-commands';
import { navigationCommands, type NavigationCommandId } from './navigation-commands';

export type EditorCommandId = 'editor.toggleMode' | NavigationCommandId | EntryCommandId;

type EditorCommand = Command & { id: EditorCommandId };

/** The edit-mode toggle, the cursor commands and the note-entry keys. */
export function editorCommands(
  services: Pick<AppServices, 'editing' | 'document' | 'selection' | 'layout' | 'entry'>,
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
    ...navigationCommands(services),
    ...entryCommands(services),
  ];
}
