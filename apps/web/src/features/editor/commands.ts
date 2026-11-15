import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

export type EditorCommandId = 'editor.toggleMode';

type EditorCommand = Command & { id: EditorCommandId };

/** WP-081 gives the toggle its shortcut and everything that happens while editing. */
export function editorCommands(
  services: Pick<AppServices, 'editing' | 'document'>,
): EditorCommand[] {
  const { editing, document } = services;
  return [
    {
      id: 'editor.toggleMode',
      title: 'Toggle edit mode',
      run: () => {
        if (document.getState().score) editing.getState().toggle();
      },
    },
  ];
}
