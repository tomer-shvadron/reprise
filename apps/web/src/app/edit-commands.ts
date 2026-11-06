import type { Command } from './command-registry';
import type { AppServices } from './services';

export type EditCommandId = 'edit.undo' | 'edit.redo' | 'edit.redoAlternate';

type EditCommand = Command & { id: EditCommandId };

/**
 * A focused text field keeps its own undo: the shortcut and the desktop menu both land here, and
 * the shortcut's default is already prevented, so the field's history is replayed by hand.
 */
function fieldStep(step: 'undo' | 'redo'): boolean {
  const focused = globalThis.document.activeElement;
  const textField =
    focused instanceof HTMLTextAreaElement ||
    focused instanceof HTMLInputElement ||
    (focused instanceof HTMLElement && focused.isContentEditable);
  if (!textField) return false;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only way to replay a text field's own undo stack
  globalThis.document.execCommand(step);
  return true;
}

export function editCommands(services: Pick<AppServices, 'document'>): EditCommand[] {
  const { document } = services;
  const undo = () => {
    if (!fieldStep('undo')) document.getState().undo();
  };
  const redo = () => {
    if (!fieldStep('redo')) document.getState().redo();
  };
  return [
    { id: 'edit.undo', title: 'Undo', shortcut: { key: 'z', mod: true }, run: undo },
    { id: 'edit.redo', title: 'Redo', shortcut: { key: 'z', mod: true, shift: true }, run: redo },
    {
      id: 'edit.redoAlternate',
      title: 'Redo',
      shortcut: { key: 'y', mod: true, only: 'other' },
      inPalette: false,
      run: redo,
    },
  ];
}
