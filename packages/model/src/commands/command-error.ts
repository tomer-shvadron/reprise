import type { Violation } from '../validate';

export type CommandErrorCode =
  | 'not-found'
  | 'invalid-value'
  | 'duplicate-id'
  | 'voice-overfull'
  | 'string-occupied'
  | 'tie-target'
  | 'off-fretboard'
  | 'not-fretted'
  | 'last-bar'
  | 'last-track'
  | 'invariant';

/** Thrown from a command's `run` before anything is committed; the score is left as it was. */
export class CommandError extends Error {
  override readonly name = 'CommandError';
  readonly code: CommandErrorCode;
  readonly command: string;
  /** The `validateScore` rules the edit would have broken, for `invariant`. */
  readonly violations: readonly Violation[];

  constructor(
    command: string,
    code: CommandErrorCode,
    message: string,
    violations: readonly Violation[] = [],
  ) {
    super(`${command}: ${message}`);
    this.command = command;
    this.code = code;
    this.violations = violations;
  }
}
