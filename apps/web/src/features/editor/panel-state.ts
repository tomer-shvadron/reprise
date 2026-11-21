import type { EffectPicker } from './dialogs';
import { EFFECT_KEY_TABLE, type EffectKeyName } from './effect-commands';
import { pickerBlockerFor } from './effect-dialogs';
import { effectReason, effectState, type EffectState } from './effect-state';
import { effectTarget } from './effect-targets';
import type { EffectInput } from './effects';
import { graceBlocker } from './grace-form';

/** What the panel knows of one toggle: its state, and why it is disabled when it is. */
export interface Known {
  state: EffectState;
  reason: string | undefined;
}

export interface PanelState {
  known: Map<EffectKeyName, Known>;
  /** Why each dialog opener is disabled, or undefined when it can open. */
  blockers: Partial<Record<EffectPicker | 'grace', string | undefined>>;
  /** Nothing in the selection can take any toggle. */
  empty: boolean;
}

const OFF = 'Turn on edit mode first';

/** Narrows the work to the controls a surface shows: the selection pill asks for 4 toggles and 1 picker. */
export interface PanelOnly {
  toggles?: readonly EffectKeyName[];
  pickers?: readonly (EffectPicker | 'grace')[];
}

/**
 * Every control's state for one selection. The target is resolved once and each effect reads from
 * it: resolving it again per effect cost about four times as much on a select-all of a large
 * score, on every selection change and edit.
 */
export function panelState(
  input: EffectInput | undefined,
  editing: boolean,
  only?: PanelOnly,
): PanelState {
  const target = input && editing ? effectTarget(input) : undefined;
  const known = new Map<EffectKeyName, Known>();
  const blocker = (picker: EffectPicker) =>
    input && target ? pickerBlockerFor(input, picker, target) : OFF;
  const wants = (picker: EffectPicker | 'grace') => !only?.pickers || only.pickers.includes(picker);
  const blockers: PanelState['blockers'] = {
    ...(wants('grace') && { grace: input && target ? graceBlocker(input, target) : OFF }),
    ...(wants('bend') && { bend: blocker('bend') }),
    ...(wants('slide') && { slide: blocker('slide') }),
    ...(wants('harmonic') && { harmonic: blocker('harmonic') }),
    ...(wants('whammy') && { whammy: blocker('whammy') }),
    ...(wants('tremolo') && { tremolo: blocker('tremolo') }),
    ...(wants('trill') && { trill: blocker('trill') }),
    ...(wants('dynamics') && { dynamics: blocker('dynamics') }),
  };
  if (input && target) {
    for (const { id, action } of EFFECT_KEY_TABLE) {
      if (only?.toggles && !only.toggles.includes(id)) continue;
      const state = effectState(input, action, target);
      known.set(id, {
        state,
        reason: state === 'unavailable' ? effectReason(input, action, target) : undefined,
      });
    }
  }
  return {
    known,
    blockers,
    empty: !input || [...known.values()].every(({ state }) => state === 'unavailable'),
  };
}
