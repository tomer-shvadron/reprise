import { dialogsOf, type EffectPicker } from './dialogs';
import type { EffectServices } from './effect-commands';
import { resolveEffect, type EffectAction, type EffectInput } from './effects';
import { entryController } from './entry-controller';
import { graceBlocker } from './grace-form';
import { visibleTracks } from './visible';

/** An action of each picker's kind, to ask whether anything in the target can take it. */
const PROBE: Record<EffectPicker, EffectAction> = {
  bend: { kind: 'bend', bend: { kind: 'bend', points: [] } },
  slide: { kind: 'slide', slide: 'outDown' },
  harmonic: { kind: 'harmonic', harmonic: { kind: 'natural' } },
  whammy: { kind: 'whammy', whammy: { kind: 'dive', points: [] } },
};

/** What the effects act on now, or undefined with no score open. */
export function effectInput(services: EffectServices): EffectInput | undefined {
  const { score, view } = services.document.getState();
  return (
    score && { score, state: services.selection.getState(), visible: visibleTracks(score, view) }
  );
}

/**
 * Why a picker should not open: nothing selected, or no note that can take the effect (a drum
 * track for a bend). The status line says it instead, so a dialog never opens on a dead end.
 */
export function pickerBlocker(services: EffectServices, picker: EffectPicker): string | undefined {
  const input = effectInput(services);
  if (!input) return 'Open a score first';
  const resolved = resolveEffect(input, PROBE[picker]);
  if ('refused' in resolved) return resolved.refused;
  const reasons = resolved.items.map((item) => item.unavailable);
  return reasons.every((reason) => reason !== undefined) ? reasons[0] : undefined;
}

type OpenServices = EffectServices;

/** Opens `picker` over the score, or reports on the status line why it cannot. */
export function openEffectPicker(
  services: OpenServices,
  picker: EffectPicker,
  returnFocus?: HTMLElement | null,
): boolean {
  // "1, then B" bends the note just entered.
  entryController(services.entry)?.flush();
  const blocked = pickerBlocker(services, picker);
  if (blocked !== undefined) {
    services.entry.getState().setMessage(blocked);
    return false;
  }
  services.entry.getState().setMessage(undefined);
  dialogsOf(services).getState().open({ kind: 'effectPicker', picker }, returnFocus);
  return true;
}

/** Opens the grace-note dialog, preset to before the beat or on it, or reports why it cannot. */
export function openGraceDialog(
  services: OpenServices,
  before: boolean,
  returnFocus?: HTMLElement | null,
): boolean {
  entryController(services.entry)?.flush();
  const input = effectInput(services);
  const blocked = input ? graceBlocker(input) : 'Open a score first';
  if (blocked !== undefined) {
    services.entry.getState().setMessage(blocked);
    return false;
  }
  services.entry.getState().setMessage(undefined);
  dialogsOf(services).getState().open({ kind: 'grace', before }, returnFocus);
  return true;
}
