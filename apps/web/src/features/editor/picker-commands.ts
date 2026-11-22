import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import type { UiStore } from '@/state/ui';

import type { EffectPicker } from './dialogs';
import { runEffect, type EffectServices } from './effect-commands';
import { PICKER_PROBE, effectInput, openEffectPicker, openGraceDialog } from './effect-dialogs';
import { resolveEffect } from './effects';
import { entryController } from './entry-controller';

export type PickerCommandId =
  | 'editor.effect.bendPicker'
  | 'editor.effect.slidePicker'
  | 'editor.effect.harmonicPicker'
  | 'editor.effect.whammyPicker'
  | 'editor.effect.trillPicker'
  | 'editor.effect.tremoloPicker'
  | 'editor.effect.dynamicsPicker'
  | 'editor.effect.grace'
  | 'editor.effect.graceOnBeat'
  | 'editor.toggleEffectsPanel';

type PickerCommand = Command & { id: PickerCommandId };

/** Shows the effects in the right panel, or closes the panel when it already shows them. */
export function toggleEffectsPanel(ui: UiStore): void {
  const { panels, rightPanelView } = ui.getState();
  if (panels.rightPanel && rightPanelView === 'effects')
    ui.getState().setPanelOpen('rightPanel', false);
  else ui.getState().showPanelView('effects');
}

/** Shows the history in the right panel, or closes the panel when it already shows it. */
export function toggleHistoryPanel(ui: UiStore): void {
  const { panels, rightPanelView } = ui.getState();
  if (panels.rightPanel && rightPanelView === 'history')
    ui.getState().setPanelOpen('rightPanel', false);
  else ui.getState().showPanelView('history');
}

/**
 * The effects that take a choice, each opening a modal dialog (a popover would let a key edit the
 * score under it): B, Shift+S, Alt+Y, Alt+V and N for the pickers (the tremolo speed and dynamics
 * pickers have no key, as Guitar Pro has none), G and Alt+G for the grace dialog,
 * and the panel's own toggle. Guitar Pro has B, G and Alt+G (its keys, kept); the slide, harmonic
 * and whammy pickers take the free neighbours of the toggles.
 */
export function pickerCommands(
  services: EffectServices & Pick<AppServices, 'ui'>,
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
      // Guitar Pro's N: off when every note has a trill, else the picker for its fret and speed.
      id: 'editor.effect.trillPicker',
      title: 'Trill…',
      shortcut: { key: 'n' },
      context: 'editing',
      repeat: false,
      run: () => {
        entryController(services.entry)?.flush();
        const input = effectInput(services);
        const resolved = input && resolveEffect(input, PICKER_PROBE.trill);
        const usable =
          resolved && !('refused' in resolved)
            ? resolved.items.filter((item) => item.unavailable === undefined || item.present)
            : [];
        if (usable.length > 0 && usable.every((item) => item.present)) {
          runEffect(services, PICKER_PROBE.trill, 'remove');
        } else {
          openEffectPicker(services, 'trill');
        }
      },
    },
    picker('editor.effect.tremoloPicker', 'Tremolo picking speed…', 'tremolo', undefined),
    picker('editor.effect.dynamicsPicker', 'Dynamics…', 'dynamics', undefined),
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
        toggleEffectsPanel(services.ui);
      },
    },
  ];
}
