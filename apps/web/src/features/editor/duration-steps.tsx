import { StepItem } from '@/app/view-items';
import type { RegisteredCommandId } from '@/app/use-command';

/** The status bar's duration menu and the selection pill's: one list, so they cannot drift. */
export const DURATION_STEPS: readonly { command: RegisteredCommandId; label: string }[] = [
  { command: 'editor.durationLonger', label: 'Longer' },
  { command: 'editor.durationShorter', label: 'Shorter' },
  { command: 'editor.toggleDot', label: 'Dotted' },
  { command: 'editor.toggleDoubleDot', label: 'Double dotted' },
  { command: 'editor.toggleTriplet', label: 'Triplet' },
];

export function DurationStepItems() {
  return DURATION_STEPS.map((step) => (
    <StepItem key={step.command} command={step.command} label={step.label} />
  ));
}
