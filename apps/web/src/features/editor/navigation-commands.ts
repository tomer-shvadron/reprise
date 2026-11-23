import type { Command } from '@/app/command-registry';
import type { AppServices } from '@/app/services';
import type { Shortcut } from '@/app/keyboard';
import type { EditCursor } from '@/state/selection';

import { entryController } from './entry-controller';
import { move, movePage, moveString, type Step } from './navigation';
import { extendRange, rangePatch, type ExtendStep } from './range';
import { visibleTracks } from './visible';
import type { Score } from '@reprise/model';
import type { LayoutResult } from '@reprise/layout';

export type NavigationCommandId =
  | 'editor.previousBeat'
  | 'editor.nextBeat'
  | 'editor.stringUp'
  | 'editor.stringDown'
  | 'editor.barStart'
  | 'editor.barEnd'
  | 'editor.previousBar'
  | 'editor.nextBar'
  | 'editor.scoreStart'
  | 'editor.scoreEnd'
  | 'editor.previousSystem'
  | 'editor.nextSystem'
  | 'editor.selectPreviousBeat'
  | 'editor.selectNextBeat'
  | 'editor.selectPreviousTrack'
  | 'editor.selectNextTrack'
  | 'editor.selectPreviousBar'
  | 'editor.selectNextBar'
  | 'editor.clearSelection';

/** `entry` is optional so the edit demo, which has no app services, still gets the cursor commands. */
type NavigationDeps = Pick<AppServices, 'editing' | 'document' | 'selection' | 'layout'> &
  Partial<Pick<AppServices, 'entry'>>;
type NavigationCommand = Command & { id: NavigationCommandId };

interface Context {
  score: Score;
  cursor: EditCursor;
  visible: string[];
  layout: LayoutResult | undefined;
}

/**
 * The cursor commands of edit mode, bound with `context: 'editing'` so the arrows move the edit
 * cursor where transport owns them in play mode. A plain move clears the range and the picked
 * notes, as moving a caret clears a selection; Shift extends the range instead. Each does
 * nothing outside edit mode or without a cursor.
 */
export function navigationCommands(deps: NavigationDeps): NavigationCommand[] {
  const { editing, document, selection, layout } = deps;

  const context = (): Context | undefined => {
    const { score, view } = document.getState();
    const { cursor } = selection.getState();
    if (!score || !cursor || !editing.getState().editing) return undefined;
    return { score, cursor, visible: visibleTracks(score, view), layout: layout.getState().result };
  };

  const go = (next: (c: Context) => EditCursor | undefined) => () => {
    const c = context();
    const cursor = c && next(c);
    if (!c || !cursor) return;
    selection.getState().setEdit({
      cursor,
      currentTrack: cursor.track,
      selection: {},
      ...rangePatch(c.score, undefined),
    });
  };

  const extend = (step: ExtendStep) => () => {
    const c = context();
    if (!c) return;
    const { range } = selection.getState();
    const extended = extendRange(c.score, { cursor: c.cursor, range }, step, c.visible);
    if (!extended) return;
    selection.getState().setEdit({
      cursor: extended.cursor,
      currentTrack: extended.cursor.track,
      selection: {},
      ...rangePatch(c.score, extended.range),
    });
  };

  const step = (kind: Step) => go((c) => move(c.score, c.cursor, kind));

  // → past the last stop of a full last bar appends a bar, as Guitar Pro does, as its own undo step.
  const next = () => {
    const controller = deps.entry && entryController(deps.entry);
    controller?.flush();
    const c = context();
    if (c && controller && !move(c.score, c.cursor, 'next')) controller.appendBar();
    else step('next')();
  };

  const command = (
    id: NavigationCommandId,
    title: string,
    shortcut: Shortcut,
    run: () => void,
  ): NavigationCommand => ({ id, title, shortcut, context: 'editing', inPalette: false, run });

  return [
    command(
      'editor.previousBeat',
      'Cursor to previous beat',
      { key: 'ArrowLeft' },
      step('previous'),
    ),
    command('editor.nextBeat', 'Cursor to next beat', { key: 'ArrowRight' }, next),
    command(
      'editor.stringUp',
      'Cursor up a string or line',
      { key: 'ArrowUp' },
      go((c) => moveString(c.score, c.cursor, -1)),
    ),
    command(
      'editor.stringDown',
      'Cursor down a string or line',
      { key: 'ArrowDown' },
      go((c) => moveString(c.score, c.cursor, 1)),
    ),
    command('editor.barStart', 'Cursor to start of bar', { key: 'Home' }, step('barStart')),
    command('editor.barEnd', 'Cursor to end of bar', { key: 'End' }, step('barEnd')),
    command(
      'editor.previousBar',
      'Cursor to previous bar',
      { key: 'ArrowLeft', mod: true },
      step('previousBar'),
    ),
    command(
      'editor.nextBar',
      'Cursor to next bar',
      { key: 'ArrowRight', mod: true },
      step('nextBar'),
    ),
    command(
      'editor.scoreStart',
      'Cursor to start of score',
      { key: 'Home', mod: true },
      step('scoreStart'),
    ),
    command(
      'editor.scoreEnd',
      'Cursor to end of score',
      { key: 'End', mod: true },
      step('scoreEnd'),
    ),
    command(
      'editor.previousSystem',
      'Cursor to previous system',
      { key: 'PageUp' },
      go((c) => c.layout && movePage(c.score, c.cursor, c.layout, -1)),
    ),
    command(
      'editor.nextSystem',
      'Cursor to next system',
      { key: 'PageDown' },
      go((c) => c.layout && movePage(c.score, c.cursor, c.layout, 1)),
    ),
    command(
      'editor.selectPreviousBeat',
      'Extend selection to previous beat',
      { key: 'ArrowLeft', shift: true },
      extend('previous'),
    ),
    command(
      'editor.selectNextBeat',
      'Extend selection to next beat',
      { key: 'ArrowRight', shift: true },
      extend('next'),
    ),
    command(
      'editor.selectPreviousTrack',
      'Extend selection to previous track',
      { key: 'ArrowUp', shift: true },
      extend('previousTrack'),
    ),
    command(
      'editor.selectNextTrack',
      'Extend selection to next track',
      { key: 'ArrowDown', shift: true },
      extend('nextTrack'),
    ),
    command(
      'editor.selectPreviousBar',
      'Extend selection to previous bar',
      { key: 'ArrowLeft', mod: true, shift: true },
      extend('previousBar'),
    ),
    command(
      'editor.selectNextBar',
      'Extend selection to next bar',
      { key: 'ArrowRight', mod: true, shift: true },
      extend('nextBar'),
    ),
    command('editor.clearSelection', 'Clear selection', { key: 'Escape' }, () => {
      const c = context();
      if (!c) return;
      selection.getState().setEdit({ selection: {}, ...rangePatch(c.score, undefined) });
    }),
  ];
}
