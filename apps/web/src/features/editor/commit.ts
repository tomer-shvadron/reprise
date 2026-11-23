import type { Command, Score } from '@reprise/model';

import { scoreIndex } from '@/features/score';
import type { DocumentStore } from '@/state/document';
import type { SelectionStore, EditCursor } from '@/state/selection';

import { cursorAtPosition, resolveCursor } from './cursor';
import type { EditPlan, Landing } from './entry';
import type { EntryStore } from './entry-store';
import { describeRefusal } from './refusal';

export interface CommitDeps {
  document: DocumentStore;
  selection: SelectionStore;
  entry: EntryStore;
}

/** The cursor at a landing in `score`, on the string and staff of `base`; undefined when it is gone. */
export function landingCursor(
  score: Score,
  landing: Landing,
  base: EditCursor,
): EditCursor | undefined {
  const index = scoreIndex(score);
  if ('beat' in landing) {
    const info = index.beats.get(landing.beat);
    return (
      info &&
      cursorAtPosition(
        score,
        { track: info.trackIndex, bar: info.masterBarIndex, voice: info.voice, stop: info.index },
        base,
      )
    );
  }
  const bar = index.barIndex.get(landing.bar);
  const track = resolveCursor(score, base)?.track;
  if (bar === undefined || track === undefined) return undefined;
  return cursorAtPosition(score, { track, bar, voice: base.voice, stop: 0 }, base);
}

/**
 * The one way an editor command applies a model command: one history step, then the cursor to
 * its landing, and a refusal (a `CommandError`) caught into the entry store's message with the
 * score untouched. Anything else is a bug and is rethrown. Returns whether the command applied.
 * `moveCursor` false leaves the cursor where it is, for an entry committed after it moved away.
 */
export function commitEdit(
  deps: CommitDeps,
  command: Command,
  options: {
    land?: Landing;
    base?: EditCursor;
    inserted?: EditPlan['inserted'];
    /** The drum lane the cursor ends on. */
    lane?: number;
    /** The string the cursor ends on, when the entry chose it. */
    string?: number;
    moveCursor?: boolean;
  } = {},
): boolean {
  const { document, selection, entry } = deps;
  try {
    document.getState().apply(command);
  } catch (error) {
    const text = describeRefusal(error);
    if (text === undefined) throw error;
    entry.getState().setMessage(text);
    return false;
  }
  entry.getState().setMessage(undefined);
  const { score } = document.getState();
  const base = options.base ?? selection.getState().cursor;
  if (options.moveCursor !== false) {
    // One write per hit: the landing is made already on the hit's lane.
    const { lane, string } = options;
    const from =
      base && (lane !== undefined || string !== undefined)
        ? {
            ...base,
            ...(lane !== undefined && { pitch: lane }),
            ...(string !== undefined && { string }),
          }
        : base;
    const landed =
      options.land && score && from ? landingCursor(score, options.land, from) : undefined;
    const current = selection.getState().cursor;
    if (landed) {
      selection.getState().setEdit({ cursor: landed, currentTrack: landed.track });
    } else if (
      current &&
      ((lane !== undefined && current.pitch !== lane) ||
        (string !== undefined && current.string !== string))
    ) {
      selection.getState().setEdit({
        cursor: {
          ...current,
          ...(lane !== undefined && { pitch: lane }),
          ...(string !== undefined && { string }),
        },
      });
    }
  }
  // Only where the cursor is: an entry committed after the cursor moved away names no beat it sits on.
  if (options.moveCursor !== false) entry.getState().setInserted(options.inserted);
  return true;
}
