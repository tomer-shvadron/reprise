import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { navigationCommands, type NavigationCommandId } from './navigation-commands';
import { trackEditCommands, type TrackEditCommandId } from './track-commands';

export type EditorCommandId = 'editor.toggleMode' | NavigationCommandId | TrackEditCommandId;

type EditorCommand = Command & { id: EditorCommandId };

/** WP-081 gives the toggle its shortcut and everything that happens while editing. */
export function editorCommands(
  services: Pick<
    AppServices,
    'editing' | 'document' | 'selection' | 'layout' | 'playback' | 'audio'
  >,
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
    ...navigationCommands(services),
    ...trackEditCommands(services),
  ];
}
