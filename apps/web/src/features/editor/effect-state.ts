import type { EffectTarget } from './effect-targets';
import { resolveEffect, type EffectAction, type EffectInput } from './effects';

/** `unavailable` when there is nothing to act on or the action would be refused for the target. */
export type EffectState = 'on' | 'off' | 'mixed' | 'unavailable';

/**
 * Whether the target has the effect, for a button's pressed state: on when every node has
 * exactly the value, off when none does, mixed between. A key would remove it in the first case
 * and set it in the other two.
 */
export function effectState(
  input: EffectInput,
  action: EffectAction,
  target?: EffectTarget,
): EffectState {
  const resolved = resolveEffect(input, action, target);
  if ('refused' in resolved) return 'unavailable';
  // A node that cannot take the effect and does not carry it is not part of the answer.
  const items = resolved.items.filter((item) => item.unavailable === undefined || item.present);
  if (items.length === 0) return 'unavailable';
  const on = items.filter((item) => item.has).length;
  if (on === items.length) return 'on';
  return on === 0 ? 'off' : 'mixed';
}

/**
 * Why `action` cannot apply to the target, for a disabled control to say; undefined when it can.
 * Uses the same resolution as `effectState`, so the two agree.
 */
export function effectReason(
  input: EffectInput,
  action: EffectAction,
  target?: EffectTarget,
): string | undefined {
  const resolved = resolveEffect(input, action, target);
  if ('refused' in resolved) return resolved.refused;
  const usable = resolved.items.filter((item) => item.unavailable === undefined || item.present);
  return usable.length === 0 ? resolved.items[0]?.unavailable : undefined;
}
