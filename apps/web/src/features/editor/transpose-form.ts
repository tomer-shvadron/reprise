import { coversEveryTrack, offersChordNames, selectionHasTarget } from './transpose';
import type { TransposeInput, TransposeScope } from './transpose';

export const SEMITONES_MIN = -24;
export const SEMITONES_MAX = 24;

/** Why `value` is not an amount the dialog can apply, or undefined when it is. */
export function semitoneError(value: number): string | undefined {
  if (!Number.isInteger(value)) return 'Enter a whole number of semitones';
  if (value < SEMITONES_MIN || value > SEMITONES_MAX) {
    return `Use ${String(SEMITONES_MIN).replace('-', '−')} to +${String(SEMITONES_MAX)}`;
  }
  return value === 0 ? 'Choose an amount other than 0' : undefined;
}

/** "Up 2 semitones", "Down 1 semitone": the amount in words, for the dialog's live label. */
export function semitoneLabel(value: number): string {
  if (!Number.isInteger(value) || value === 0) return 'No change';
  const count = Math.abs(value);
  return `${value > 0 ? 'Up' : 'Down'} ${String(count)} ${count === 1 ? 'semitone' : 'semitones'}`;
}

/** What the dialog offers for a scope: whether it can be chosen, and what its options can do. */
export interface ScopeOffer {
  selection: boolean;
  chordNames: boolean;
  keySignature: boolean;
}

export function scopeOffer(input: TransposeInput, scope: TransposeScope): ScopeOffer {
  return {
    selection: selectionHasTarget(input),
    chordNames: offersChordNames(input, scope),
    keySignature: coversEveryTrack(input, scope),
  };
}

/**
 * The scope the dialog opens on: the selection when a range or picked notes make one, else the
 * current track. A cursor alone is not a selection the player made.
 */
export function defaultScope(input: TransposeInput): TransposeScope {
  const { range, selection } = input.state;
  const picked = (selection.noteIds?.length ?? 0) + (selection.beatIds?.length ?? 0) > 0;
  return (range || picked) && selectionHasTarget(input) ? 'selection' : 'track';
}

// The last amount used, per document store: the next dialog opens on it.
const remembered = new WeakMap<object, number>();

export const lastSemitones = (owner: object): number => remembered.get(owner) ?? 1;

export function rememberSemitones(owner: object, value: number): void {
  remembered.set(owner, value);
}
