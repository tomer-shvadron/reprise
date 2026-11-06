import type { ViolationRule } from '@reprise/model';

export type GpifWarningCode =
  | 'not-modelled'
  | 'unknown-element'
  | 'unknown-value'
  | 'invalid-value'
  | 'missing-reference'
  | 'multiple-staves'
  | 'voice-dropped'
  | 'simile-expanded'
  | 'grace-without-beat'
  | 'grace-duration-clamped'
  | 'grace-tie-released'
  | 'hammer-pull-without-destination'
  | 'tempo-moved'
  | 'automation-dropped'
  | 'default-tempo'
  | 'long-note-tied'
  | 'drum-articulation'
  | ViolationRule;

/**
 * Something the reader could not carry into the model, or changed on the way in. `path` names
 * the gpif element (`Notes/Note[3]/Properties/Property[Slide]`), or the model path for an
 * invariant violation. Repeats of one kind of loss (a property on every beat) are folded into
 * one warning with `count`, keeping the first path.
 */
export interface GpifWarning {
  code: GpifWarningCode;
  message: string;
  path: string;
  count: number;
}

export interface WarningSink {
  /** `key` folds repeats: warnings with the same key count up instead of adding entries. */
  warn(code: GpifWarningCode, path: string, message: string, key?: string): void;
}

export class WarningCollector implements WarningSink {
  readonly #byKey = new Map<string, GpifWarning>();
  readonly #all: GpifWarning[] = [];

  warn(code: GpifWarningCode, path: string, message: string, key?: string): void {
    if (key !== undefined) {
      const existing = this.#byKey.get(`${code}\u0000${key}`);
      if (existing) {
        existing.count++;
        return;
      }
    }
    const warning: GpifWarning = { code, message, path, count: 1 };
    this.#all.push(warning);
    if (key !== undefined) this.#byKey.set(`${code}\u0000${key}`, warning);
  }

  get warnings(): GpifWarning[] {
    return this.#all;
  }
}
