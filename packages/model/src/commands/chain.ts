import type { Command } from '../history';
import type { Score } from '../score';
import { CommandError } from './command-error';

/** A step is a command, or a function of the score the previous step produced. */
export type ChainStep = Command | ((score: Score) => Command);

/**
 * Runs `steps` in order, each on the score the previous one produced, as one command: one
 * history step, one change set, and atomic, since a step that throws leaves the score as it was.
 * A refusal carries the failing step's command name.
 *
 * Every locator searches the score from before the whole recipe (`baseOf`), so steps cannot
 * share one Immer draft: `insertBeat` then `setNote` on the new beat would not find it. Instead
 * `applyCommand` applies each step to the score its predecessor returned and merges the steps'
 * own patches the way a history group does, so the cost stays what each step changed (patches
 * of one recipe over two bars of a long score do not shift every bar after them). A step that
 * needs ids an earlier step created is a function of the score so far; steps that create nodes
 * can also take their ids up front. A chain is a command, so chains nest.
 */
export function chain(name: string, steps: readonly ChainStep[]): Command {
  return {
    name,
    run() {
      throw new CommandError(
        name,
        'invariant',
        'a chain runs through applyCommand, not on a draft',
      );
    },
    compose(score, step) {
      if (steps.length === 0) {
        throw new CommandError(name, 'invalid-value', 'a chain needs at least one step');
      }
      let current = score;
      for (const item of steps) {
        current = step(typeof item === 'function' ? item(current) : item).score;
      }
    },
  };
}
