import type { Note } from '@reprise/model';

import { ARTICULATION, DYNAMICS_VELOCITY, VELOCITY_STEP } from './parameters';

/** The dynamics mark in velocity, moved up for accents and down for ghost notes and hammer-ons. */
export function noteVelocity(
  note: Pick<Note, 'dynamics' | 'accent' | 'ghost'>,
  options: { hammer?: boolean } = {},
): number {
  let steps = 0;
  if (note.accent === 'accent') steps += ARTICULATION.accentSteps;
  if (note.accent === 'heavy') steps += ARTICULATION.heavyAccentSteps;
  if (note.ghost) steps += ARTICULATION.ghostSteps;
  if (options.hammer) steps += ARTICULATION.hammerSteps;
  const velocity = DYNAMICS_VELOCITY[note.dynamics] + steps * VELOCITY_STEP;
  return Math.min(127, Math.max(1, velocity));
}
