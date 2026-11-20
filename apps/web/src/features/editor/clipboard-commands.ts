import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { targetBars } from '@/features/transport/menu-target';

import { copyBars } from './clipboard-actions';
import { clipboardController } from './clipboard-events';
import { clipboardOf } from './clipboard-store';

export type ClipboardCommandId =
  | 'editor.copy'
  | 'editor.cut'
  | 'editor.paste'
  | 'editor.pasteInsert'
  | 'editor.pasteOverwrite'
  | 'editor.copyBars';

type ClipboardCommand = Command & { id: ClipboardCommandId };

/**
 * Copy, cut and paste in edit mode. ⌘C, ⌘X and ⌘V are `native`: the dispatcher leaves the key to
 * the browser, whose clipboard event `installClipboard` handles, while the table and the palette
 * still show it. From the palette a command raises that event itself (Copy, Cut) or pastes the
 * internal clipboard (Paste). The two explicit pastes have no key; ⌘V follows the insert or
 * overwrite mode of the status line.
 */
export function clipboardCommands(
  services: Pick<AppServices, 'entry' | 'document' | 'selection' | 'menuTarget' | 'transport'>,
): ClipboardCommand[] {
  const { entry } = services;
  const hasClip = () => clipboardOf(services).get() !== undefined;
  return [
    {
      id: 'editor.copy',
      title: 'Copy',
      shortcut: { key: 'c', mod: true },
      native: true,
      context: 'editing',
      run: () => {
        clipboardController(entry)?.copy();
      },
    },
    {
      id: 'editor.cut',
      title: 'Cut',
      shortcut: { key: 'x', mod: true },
      native: true,
      context: 'editing',
      run: () => {
        clipboardController(entry)?.cut();
      },
    },
    {
      id: 'editor.paste',
      title: 'Paste',
      shortcut: { key: 'v', mod: true },
      native: true,
      context: 'editing',
      enabled: hasClip,
      run: () => {
        clipboardController(entry)?.paste();
      },
    },
    {
      id: 'editor.pasteInsert',
      title: 'Paste as insert',
      context: 'editing',
      enabled: hasClip,
      run: () => {
        clipboardController(entry)?.paste('insert');
      },
    },
    {
      id: 'editor.pasteOverwrite',
      title: 'Paste over',
      context: 'editing',
      enabled: hasClip,
      run: () => {
        clipboardController(entry)?.paste('overwrite');
      },
    },
    {
      id: 'editor.copyBars',
      title: 'Copy bars',
      // No key: ⌘C stays the editing copy. This is the play-mode menu's way to the same clip.
      inPalette: false,
      enabled: () => targetBars(services) !== undefined,
      run: () => {
        copyBars(services);
      },
    },
  ];
}
