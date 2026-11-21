import { useMemo, type MouseEvent } from 'react';
import { useStore } from 'zustand';

import { useAppServices } from '@/app/services-context';

import type { EffectPicker } from './dialogs';
import { effectInput, openEffectPicker, openGraceDialog } from './effect-dialogs';
import type { EffectState } from './effect-state';
import { panelState, type PanelOnly, type PanelState } from './panel-state';

/** `aria-pressed` for an effect state. */
export const pressedOf = (state: EffectState): boolean | 'mixed' =>
  state === 'on' ? true : state === 'mixed' ? 'mixed' : false;

/**
 * The state of the effect controls for the selection, which the effects panel and the selection
 * pill share, so a button reads the same on both. `only` narrows the work to the controls shown.
 * `only` must be a stable object (module-level): it is a dependency.
 */
export function useEffectPanelState(only?: PanelOnly): PanelState {
  const services = useAppServices();
  const { document, selection, editing } = services;
  const isEditing = useStore(editing, (state) => state.editing);
  const score = useStore(document, (state) => state.score);
  const view = useStore(document, (state) => state.view);
  const state = useStore(selection);
  return useMemo(
    () => panelState(effectInput(services), isEditing, only),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the stores' state is the dependency
    [services, isEditing, score, view, state, only],
  );
}

/**
 * Opens an effect's dialog. From the keyboard (a press with `detail` 0) focus comes back to the
 * button; after a click it stays with the page, so Space and Enter keep their meaning there.
 */
export function usePickerOpener(
  picker: EffectPicker | 'grace',
): (event: MouseEvent<HTMLButtonElement>) => void {
  const services = useAppServices();
  return (event) => {
    const from = event.detail === 0 ? event.currentTarget : undefined;
    if (picker === 'grace') openGraceDialog(services, true, from);
    else openEffectPicker(services, picker, from);
  };
}
