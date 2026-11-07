/**
 * Commands, changes and undo history (ADR-0011). A command mutates an Immer draft; `applyCommand`
 * records the forward and inverse patches, and undo and redo replay them, so a history step
 * costs what the edit changed, not a copy of the score.
 *
 * `Change.touchedBars` holds master-bar ids: the bar column layout re-flows, shared by every
 * track. Each patch path maps to columns, resolved against the score both before and after the
 * edit, so inserted and removed bars are both reported:
 *
 * - `tracks/t/bars/b/...` and `masterBars/m/...` touch column `b` or `m`.
 * - `tracks/t/<property>` touches every column, except the properties layout never draws:
 *   `channel`, `sound`, `program`, `bank` and the raw `lyrics` block (layout draws `Beat.lyrics`).
 * - Replacing, adding or removing a whole track, a track's `bars`, `tracks` or `masterBars`
 *   touches every column.
 * - `meta`, `id` and `version` touch none.
 *
 * Ids are listed in score order, then any that only the score before the edit had. A bar that
 * only shifted is not listed: its content is unchanged, and layout re-measures the listed bars
 * and re-renders the systems within reach of them.
 *
 * Immer writes an array splice as a `replace` of every element after it, so a bar inserted near
 * the start of a long score would be thousands of patches that each carry a whole bar, and undo
 * would clone every one. `applyCommand` rewrites such a run as the splice plus a `replace` for
 * each shifted element the command also edited.
 */
import { applyPatches, enablePatches, produceWithPatches } from 'immer';
import type { Patch } from 'immer';

import type { Id } from './id';
import type { TransposeWarning } from './pitch';
import type { Score } from './score';

enablePatches();

export type { Patch } from 'immer';

export type CommandWarningCode = TransposeWarning;

/** Something an applied edit changed or left beyond what it was asked to; never a refusal. */
export interface CommandWarning {
  code: CommandWarningCode;
  /** The note the warning is about. */
  noteId: Id;
  message: string;
}

export interface Command {
  name: string;
  /** Mutates an Immer draft; throws `CommandError` and leaves nothing applied on bad input. */
  run(draft: Score, warn: (warning: CommandWarning) => void): void;
}

export interface Change {
  /** The command's name, or the group's label. */
  command: string;
  patches: Patch[];
  inverse: Patch[];
  touchedBars: Id[];
}

export interface Applied {
  score: Score;
  change: Change;
  /** The command's warnings; always empty from `undo` and `redo`, which replay patches. */
  warnings: CommandWarning[];
}

export function applyCommand(score: Score, command: Command): Applied {
  const warnings: CommandWarning[] = [];
  const [next, raw, rawInverse] = produceWithPatches(score, (draft) => {
    command.run(draft, (warning) => {
      warnings.push(warning);
    });
  });
  if (raw.length === 0) {
    return {
      score,
      change: { command: command.name, patches: [], inverse: [], touchedBars: [] },
      warnings,
    };
  }
  const patches = compactSplices(score, next, raw);
  return {
    score: next,
    change: {
      command: command.name,
      patches,
      inverse: compactSplices(next, score, rawInverse),
      touchedBars: touchedBars(score, next, patches),
    },
    warnings,
  };
}

type Path = readonly (string | number)[];

function arrayKey(patch: Patch): string | undefined {
  return typeof patch.path.at(-1) === 'number'
    ? JSON.stringify(patch.path.slice(0, -1))
    : undefined;
}

function arrayAt(score: Score, path: Path): readonly unknown[] | undefined {
  let node: unknown = score;
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Reflect.get(node, key);
  }
  return Array.isArray(node) ? node : undefined;
}

/** Rewrites each run of patches on one array as a splice when `from` and `to` differ by one element. */
function compactSplices(from: Score, to: Score, patches: Patch[]): Patch[] {
  const counts = new Map<string, number>();
  for (const patch of patches) {
    const key = arrayKey(patch);
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const result: Patch[] = [];
  for (let start = 0; start < patches.length;) {
    const first = patches[start];
    if (!first) break;
    const key = arrayKey(first);
    let end = start + 1;
    for (
      let next = patches[end];
      key !== undefined && next && arrayKey(next) === key;
      next = patches[++end]
    );
    const run = patches.slice(start, end);
    const splice =
      key !== undefined && counts.get(key) === run.length
        ? spliceOf(from, to, first.path.slice(0, -1))
        : undefined;
    result.push(...(splice && splice.length < run.length ? splice : run));
    start = end;
  }
  return result;
}

function spliceOf(from: Score, to: Score, path: Path): Patch[] | undefined {
  const before = arrayAt(from, path);
  const after = arrayAt(to, path);
  if (!before || !after || Math.abs(after.length - before.length) !== 1) return undefined;
  const inserted = after.length > before.length;
  const shorter = inserted ? before : after;
  let index = 0;
  while (index < shorter.length && before[index] === after[index]) index += 1;
  const patches: Patch[] = inserted
    ? [{ op: 'add', path: [...path, index], value: after[index] }]
    : [{ op: 'remove', path: [...path, index] }];
  for (let j = inserted ? index + 1 : index; j < after.length; j++) {
    const was = inserted ? before[j - 1] : before[j + 1];
    if (after[j] !== was) patches.push({ op: 'replace', path: [...path, j], value: after[j] });
  }
  return patches;
}

const LAYOUT_NEUTRAL_TRACK_KEYS = new Set<string | number>([
  'channel',
  'sound',
  'program',
  'bank',
  'lyrics',
]);

export function touchedBars(before: Score, after: Score, patches: readonly Patch[]): Id[] {
  const columns = new Set<number>();
  let all = false;
  for (const { path } of patches) {
    const [root, index, key, column] = path;
    if (root === 'masterBars') {
      if (typeof index === 'number') columns.add(index);
      else all = true;
    } else if (root === 'tracks') {
      if (key === 'bars' && typeof column === 'number') columns.add(column);
      else if (key === undefined || !LAYOUT_NEUTRAL_TRACK_KEYS.has(key)) all = true;
    } else if (root === undefined) {
      all = true;
    }
    if (all) break;
  }
  const ids = new Set<Id>();
  const collect = (score: Score): void => {
    score.masterBars.forEach((masterBar, m) => {
      if (all || columns.has(m)) ids.add(masterBar.id);
    });
  };
  collect(after);
  collect(before);
  return [...ids];
}

export class HistoryError extends Error {
  override readonly name = 'HistoryError';
}

export interface History {
  /** Applies `command` to `score`, which must be the score this history last returned, if any. */
  apply(score: Score, command: Command): Applied;
  /** Undoes the last step; the change carries the patches it applied. */
  undo(): Applied | undefined;
  redo(): Applied | undefined;
  /** Opens a group: every apply until the matching `endGroup` is one undo step. Groups nest and flatten. */
  beginGroup(label: string): void;
  endGroup(): void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The label of the step `undo` or `redo` would replay, for the menu. */
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  /** Forward and inverse patches of every step held, for budgets and debugging. */
  readonly steps: readonly Change[];
}

interface Group {
  label: string;
  depth: number;
  changes: Change[];
}

export function createHistory(): History {
  const undoStack: Change[] = [];
  let redoStack: Change[] = [];
  let currentScore: Score | undefined;
  let group: Group | undefined;

  const push = (change: Change): void => {
    undoStack.push(change);
    redoStack = [];
  };

  const replay = (change: Change, patches: Patch[], inverse: Patch[]): Applied => {
    if (group) throw new HistoryError('cannot undo or redo while a group is open');
    if (!currentScore) throw new HistoryError('the history has no score');
    currentScore = applyPatches(currentScore, patches);
    return {
      score: currentScore,
      change: { command: change.command, patches, inverse, touchedBars: change.touchedBars },
      warnings: [],
    };
  };

  return {
    apply(score, command) {
      if (
        currentScore &&
        score !== currentScore &&
        (undoStack.length > 0 || redoStack.length > 0 || group)
      ) {
        throw new HistoryError('apply expects the score this history last returned');
      }
      const applied = applyCommand(score, command);
      currentScore = applied.score;
      if (applied.change.patches.length === 0) return applied;
      if (group) group.changes.push(applied.change);
      else push(applied.change);
      return applied;
    },

    undo() {
      const change = undoStack.at(-1);
      if (!change) return undefined;
      const applied = replay(change, change.inverse, change.patches);
      redoStack.push(undoStack.pop() ?? change);
      return applied;
    },

    redo() {
      const change = redoStack.at(-1);
      if (!change) return undefined;
      const applied = replay(change, change.patches, change.inverse);
      undoStack.push(redoStack.pop() ?? change);
      return applied;
    },

    beginGroup(label) {
      if (group) group.depth += 1;
      else group = { label, depth: 1, changes: [] };
    },

    endGroup() {
      if (!group) throw new HistoryError('endGroup without beginGroup');
      group.depth -= 1;
      if (group.depth > 0) return;
      const { label, changes } = group;
      group = undefined;
      if (changes.length > 0) push(mergeChanges(label, changes));
    },

    get canUndo() {
      return undoStack.length > 0 && !group;
    },
    get canRedo() {
      return redoStack.length > 0 && !group;
    },
    get undoLabel() {
      return undoStack.at(-1)?.command;
    },
    get redoLabel() {
      return redoStack.at(-1)?.command;
    },
    get steps() {
      return undoStack.concat(redoStack);
    },
  };
}

function mergeChanges(label: string, changes: Change[]): Change {
  return {
    command: label,
    patches: changes.flatMap((change) => change.patches),
    inverse: [...changes].reverse().flatMap((change) => change.inverse),
    touchedBars: [...new Set(changes.flatMap((change) => change.touchedBars))],
  };
}
