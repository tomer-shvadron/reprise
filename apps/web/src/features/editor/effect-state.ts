import { resolveEffect, type EffectAction, type EffectInput } from './effects';

/** `unavailable` when there is nothing to act on or the action would be refused for the target. */
export type EffectState = 'on' | 'off' | 'mixed' | 'unavailable';

/**
 * Whether the target has the effect, for a button's pressed state: on when every node has
 * exactly the value, off when none does, mixed between. A key would remove it in the first case
 * and set it in the other two.
 */
export function effectState(input: EffectInput, action: EffectAction): EffectState {
  const resolved = resolveEffect(input, action);
  if ('refused' in resolved || resolved.items.length === 0) return 'unavailable';
  const on = resolved.items.filter((item) => item.has).length;
  if (on === resolved.items.length) return 'on';
  return on === 0 ? 'off' : 'mixed';
}
