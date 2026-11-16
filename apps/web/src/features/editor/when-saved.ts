import type { AppServices } from '@/app/services';

import { dialogsOf } from './dialogs';

/**
 * Runs `onContinue` now when the open document has no unsaved changes, else after the user saves
 * or chooses not to, through the Save / Don't save / Cancel dialog `EditorDialogs` mounts. `action`
 * completes "Save changes to “name” before …?". New song, and WP-061's Open, Close and quit, share it.
 */
export function whenSaved(
  services: Pick<AppServices, 'document'>,
  action: string,
  onContinue: () => void,
): void {
  if (!services.document.getState().dirty) {
    onContinue();
    return;
  }
  dialogsOf(services).getState().open({ kind: 'unsaved', action, onContinue });
}
