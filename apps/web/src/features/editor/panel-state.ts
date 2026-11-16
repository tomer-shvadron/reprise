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
  blockers: Record<EffectPicker | 'grace', string | undefined>;
  /** Nothing in the selection can take any toggle. */
  empty: boolean;
}

const PICKERS: readonly EffectPicker[] = [
  'bend',
  'slide',
  'harmonic',
  'whammy',
  'tremolo',
  'trill',
  'dynamics',
];

const OFF = 'Turn on edit mode first';

/**
 * Every control's state for one selection. The target is resolved once and each effect reads from
 * it: resolving it again per effect cost about four times as much on a select-all of a large
 * score, on every selection change and edit.
 */
export function panelState(input: EffectInput | undefined, editing: boolean): PanelState {
  const target = input && editing ? effectTarget(input) : undefined;
  const known = new Map<EffectKeyName, Known>();
  const blockers = {
    grace: input && target ? graceBlocker(input, target) : OFF,
  } as PanelState['blockers'];
  for (const picker of PICKERS) {
    blockers[picker] = input && target ? pickerBlockerFor(input, picker, target) : OFF;
  }
  if (input && target) {
    for (const { id, action } of EFFECT_KEY_TABLE) {
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
