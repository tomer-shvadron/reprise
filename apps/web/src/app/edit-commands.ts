import { historyLabel } from '@/features/editor';

import type { Command } from './command-registry';
import type { AppServices } from './services';
import { isTextField } from './text-field';

export type EditCommandId = 'edit.undo' | 'edit.redo' | 'edit.redoAlternate';

type EditCommand = Command & { id: EditCommandId };

/**
 * A focused text field keeps its own undo: the shortcut and the desktop menu both land here, and
 * the shortcut's default is already prevented, so the field's history is replayed by hand.
 */
function fieldStep(step: 'undo' | 'redo'): boolean {
  if (!isTextField(globalThis.document.activeElement)) return false;
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
  // Read when the palette draws, so the title names the step the key would replay.
  const titled = (verb: 'Undo' | 'Redo') => {
    const stacks = document.getState().historyLabels;
    const next = (verb === 'Undo' ? stacks.undo : stacks.redo)[0];
    return next === undefined ? verb : `${verb} ${historyLabel(next)}`;
  };
  return [
    {
      id: 'edit.undo',
      get title() {
        return titled('Undo');
      },
      shortcut: { key: 'z', mod: true },
      run: undo,
    },
    {
      id: 'edit.redo',
      get title() {
        return titled('Redo');
      },
      shortcut: { key: 'z', mod: true, shift: true },
      run: redo,
    },
    {
      id: 'edit.redoAlternate',
      get title() {
        return titled('Redo');
      },
      shortcut: { key: 'y', mod: true, only: 'other' },
      inPalette: false,
      run: redo,
    },
  ];
}
