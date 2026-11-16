import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';

import { openEffectPicker, openGraceDialog } from './effect-dialogs';
import type { EffectPicker } from './dialogs';

export type PickerCommandId =
  | 'editor.effect.bendPicker'
  | 'editor.effect.slidePicker'
  | 'editor.effect.harmonicPicker'
  | 'editor.effect.whammyPicker'
  | 'editor.effect.grace'
  | 'editor.effect.graceOnBeat'
  | 'editor.toggleEffectsPanel';

type PickerCommand = Command & { id: PickerCommandId };

/**
 * The effects that take a choice, each opening a modal dialog (a popover would let a key edit the
 * score under it): B, Shift+S, Alt+Y and Alt+V for the pickers, G and Alt+G for the grace dialog,
 * and the panel's own toggle. Guitar Pro has B, G and Alt+G (its keys, kept); the slide, harmonic
 * and whammy pickers take the free neighbours of the toggles.
 */
export function pickerCommands(
  services: Pick<AppServices, 'document' | 'selection' | 'entry' | 'ui'>,
): PickerCommand[] {
  const picker = (
    id: PickerCommandId,
    title: string,
    which: EffectPicker,
    shortcut: Command['shortcut'],
  ): PickerCommand => ({
    id,
    title,
    ...(shortcut && { shortcut }),
    context: 'editing',
    repeat: false,
    run: () => {
      openEffectPicker(services, which);
    },
  });
  return [
    picker('editor.effect.bendPicker', 'Bend…', 'bend', { key: 'b' }),
    picker('editor.effect.slidePicker', 'Slide…', 'slide', { key: 's', shift: true }),
    picker('editor.effect.harmonicPicker', 'Harmonic…', 'harmonic', { key: 'y', alt: true }),
    picker('editor.effect.whammyPicker', 'Whammy bar…', 'whammy', { key: 'v', alt: true }),
    {
      id: 'editor.effect.grace',
      title: 'Grace note…',
      shortcut: { key: 'g' },
      context: 'editing',
      repeat: false,
      run: () => {
        openGraceDialog(services, true);
      },
    },
    {
      id: 'editor.effect.graceOnBeat',
      title: 'Grace note on the beat…',
      shortcut: { key: 'g', alt: true },
      context: 'editing',
      repeat: false,
      run: () => {
        openGraceDialog(services, false);
      },
    },
    {
      id: 'editor.toggleEffectsPanel',
      title: 'Toggle effects panel',
      run: () => {
        const { ui } = services;
        const { panels, rightPanelView } = ui.getState();
        if (panels.rightPanel && rightPanelView === 'effects') {
          ui.getState().setPanelOpen('rightPanel', false);
        } else {
          ui.getState().showPanelView('effects');
        }
      },
    },
  ];
}
