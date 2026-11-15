import { applyPatches } from 'immer';

import { applyCommand } from '../history';
import type { Command } from '../history';
import { CommandError } from './command-error';
import { baseOf } from './locate';

/**
 * Runs `steps` in order, each on the score the previous one produced, as one command: one
 * history step, one change set, and atomic, since a step that throws leaves the score as it was.
 *
 * Every locator searches the score from before the whole recipe (`baseOf`), so steps cannot
 * share one Immer draft: `insertBeat` then `setNote` on the new beat would not find it. Instead
 * each step is applied to the score its predecessor returned, with its own draft, and the
 * patches it recorded are replayed onto the recipe's draft. The recipe then records the net
 * patches for the whole sequence, so its `touchedBars` cover every step (a bar inserted and
 * removed again by later steps is in neither score and needs no re-layout). Steps that create
 * nodes take their ids up front, so a later step can name them. A sequence is a command, so
 * sequences nest.
 */
export function sequence(name: string, steps: readonly Command[]): Command {
  return {
    name,
    run(draft, warn) {
      if (steps.length === 0) {
        throw new CommandError(name, 'invalid-value', 'a sequence needs at least one step');
      }
      let score = baseOf(draft);
      for (const step of steps) {
        const applied = applyCommand(score, step);
        for (const warning of applied.warnings) warn(warning);
        if (applied.change.patches.length === 0) continue;
        applyPatches(draft, applied.change.patches);
        score = applied.score;
      }
    },
  };
}
