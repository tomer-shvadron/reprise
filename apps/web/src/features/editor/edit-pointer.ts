import type { LayoutResult } from '@reprise/layout';
import type { Id, Score } from '@reprise/model';

import type { DocumentStore } from '@/state/document';
import type { Gesture, ScorePointerEvent } from '@/features/score';
import type { EditCursor, EditRange, SelectionState, SelectionStore } from '@/state/selection';

import { cursorAtPosition } from './cursor';
import { cursorFromHit, locate } from './locate';
import { endOf, extendRangeTo, rangePatch } from './range';
import { scoreIndex } from '@/features/score';
import { visibleTracks } from './visible';

export interface EditPointerDeps {
  selection: SelectionStore;
  document: DocumentStore;
}

type Before = Pick<
  SelectionState,
  'cursor' | 'range' | 'selection' | 'bars' | 'barsAnchor' | 'currentTrack'
>;

/** A press on a column's own area, above the staves where the bar number sits: it takes whole bars. */
const onBarArea = (event: ScorePointerEvent): boolean =>
  event.anchor?.kind === 'bar' && event.anchor.track === undefined;

const mod = (event: ScorePointerEvent): boolean => event.event.metaKey || event.event.ctrlKey;

/**
 * The editor's pointer handling: a click places the cursor (and picks the note under it), Shift
 * extends a beat range from the cursor, Cmd or Ctrl toggles a note in the picked set, and a drag
 * makes a range, previewed while it runs and restored if it is cancelled. A press on a column's
 * bar-number area takes whole bars. Returns the handler to call with each gesture; true when it
 * moved the cursor for good (a click or the end of a drag), so the caller can reveal and seek.
 */
export function createEditPointer(deps: EditPointerDeps) {
  const { selection, document } = deps;
  let before: Before | undefined;

  const write = (score: Score, cursor: EditCursor, range: EditRange | undefined, picked = {}) => {
    selection.getState().setEdit({
      cursor,
      currentTrack: cursor.track,
      selection: picked,
      ...rangePatch(score, range),
    });
  };

  /** The cursor on the first stop of the bar a column names, in the current track and voice. */
  const barCursor = (score: Score, event: ScorePointerEvent, origin: EditCursor | undefined) => {
    const index = scoreIndex(score);
    const bar =
      event.anchor?.masterBar === undefined
        ? undefined
        : index.barIndex.get(event.anchor.masterBar);
    const wanted = origin?.track ?? selection.getState().currentTrack ?? score.tracks[0]?.id;
    const track = score.tracks.findIndex(({ id }) => id === wanted);
    if (bar === undefined || track < 0) return undefined;
    return cursorAtPosition(
      score,
      { track, bar, voice: origin?.voice ?? 0, stop: 0 },
      origin ?? { string: 1, staff: 'tab' },
    );
  };

  const wholeBar = (cursor: EditCursor, track?: Id): EditRange['anchor'] => ({
    ...endOf(cursor, 'bars'),
    track: track ?? cursor.track,
  });

  return (layout: LayoutResult, gesture: Gesture): boolean => {
    const { score, view } = document.getState();
    if (!score) return false;
    const state = selection.getState();
    const visible = visibleTracks(score, view);

    if (gesture.kind === 'cancel') {
      if (before) selection.getState().setEdit(before);
      before = undefined;
      return false;
    }

    if (gesture.kind === 'click') {
      const { event } = gesture;
      if (onBarArea(event)) {
        const cursor = barCursor(score, event, state.cursor);
        if (!cursor) return false;
        const range = gesture.shift
          ? extendRangeTo(state, endOf(cursor, 'bars'), 'bars')
          : { kind: 'bars' as const, anchor: wholeBar(cursor), focus: wholeBar(cursor) };
        write(score, cursor, range);
        return true;
      }
      const hit = locate(layout, score, event, state.cursor, visible);
      const cursor = hit && cursorFromHit(score, hit);
      if (!hit || !cursor) return false;
      if (gesture.shift) {
        write(score, cursor, extendRangeTo(state, endOf(cursor)));
      } else if (mod(event) && hit.note !== undefined) {
        const noteIds = state.selection.noteIds ?? [];
        const toggled = noteIds.includes(hit.note)
          ? noteIds.filter((id) => id !== hit.note)
          : [...noteIds, hit.note];
        write(score, cursor, undefined, { noteIds: toggled });
      } else {
        write(score, cursor, undefined, hit.note === undefined ? {} : { noteIds: [hit.note] });
      }
      return true;
    }

    if (gesture.kind !== 'area') return false;
    before ??= {
      cursor: state.cursor,
      range: state.range,
      selection: state.selection,
      bars: state.bars,
      barsAnchor: state.barsAnchor,
      currentTrack: state.currentTrack,
    };
    const origin = before.cursor;
    const done = gesture.done;
    if (done) before = undefined;

    if (onBarArea(gesture.from)) {
      const from = barCursor(score, gesture.from, origin);
      const toColumn = gesture.to.column ?? gesture.to.anchor;
      const toBar =
        toColumn?.masterBar === undefined
          ? undefined
          : scoreIndex(score).barIndex.get(toColumn.masterBar);
      const to =
        from && toBar !== undefined && toColumn
          ? barCursor(score, { ...gesture.to, anchor: toColumn }, from)
          : undefined;
      if (!from || !to) return false;
      write(score, to, { kind: 'bars', anchor: wholeBar(from), focus: wholeBar(to, from.track) });
      return done;
    }

    const fromHit = locate(layout, score, gesture.from, origin, visible);
    const toHit = locate(layout, score, gesture.to, origin, visible);
    const from = fromHit && cursorFromHit(score, fromHit);
    const to = toHit && cursorFromHit(score, toHit);
    if (!from || !to) return false;
    write(score, to, { kind: 'beats', anchor: endOf(from), focus: endOf(to) });
    return done;
  };
}
