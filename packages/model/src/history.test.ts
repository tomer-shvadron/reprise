import { applyPatches } from 'immer';
import { describe, expect, it } from 'vitest';

import { insertBar, removeBar, setMasterBar } from './commands/bar-commands';
import { CommandError } from './commands/command-error';
import { setNote } from './commands/note-commands';
import { beatOf, buildScore, noteOf } from './commands/test-score';
import { moveTrack } from './commands/track-commands';
import { HistoryError, applyCommand, createHistory } from './history';
import type { Command } from './history';

const retitle = (title: string): Command => ({
  name: 'retitle',
  run(draft) {
    draft.meta.title = title;
  },
});

describe('applyCommand', () => {
  it('returns forward and inverse patches that replay the edit both ways', () => {
    const score = buildScore();
    const { score: after, change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 0, 2, 0).id }, { string: 2, fret: 9 }),
    );
    expect(change.command).toBe('setNote');
    expect(applyPatches(score, change.patches)).toEqual(after);
    expect(applyPatches(after, change.inverse)).toEqual(score);
  });

  it('leaves the score untouched when a command throws', () => {
    const score = buildScore();
    const snapshot = JSON.stringify(score);
    expect(() =>
      applyCommand(score, setNote({ beatId: beatOf(score, 0, 2, 0).id }, { string: 9, fret: 0 })),
    ).toThrow(CommandError);
    expect(JSON.stringify(score)).toBe(snapshot);
  });
});

describe('touchedBars', () => {
  it('names the master bar of an edited note, and none for metadata', () => {
    const score = buildScore();
    const { change } = applyCommand(
      score,
      setNote({ beatId: beatOf(score, 0, 2, 0).id }, { string: 2, fret: 8 }),
    );
    expect(change.touchedBars).toEqual([score.masterBars[2]?.id]);
    expect(applyCommand(score, retitle('Song')).change.touchedBars).toEqual([]);
  });

  it('names every bar when the track order changes', () => {
    const score = buildScore();
    const { change } = applyCommand(score, moveTrack({ trackId: score.tracks[1]?.id ?? '' }, 0));
    expect(change.touchedBars).toEqual(score.masterBars.map((bar) => bar.id));
  });

  it('names a removed bar and the bars that moved up, in score order', () => {
    const score = buildScore();
    const [, second, third, fourth] = score.masterBars.map((bar) => bar.id);
    const { change } = applyCommand(score, removeBar({ masterBarId: second ?? '' }));
    expect(change.touchedBars).toEqual([third, fourth, second]);
  });
});

describe('createHistory', () => {
  it('undoes and redoes step by step, and a new edit clears the redo stack', () => {
    const score = buildScore();
    const history = createHistory();
    const first = history.apply(score, retitle('One')).score;
    const second = history.apply(first, retitle('Two')).score;
    expect(history.undoLabel).toBe('retitle');
    expect(history.undo()?.score).toEqual(first);
    expect(history.undo()?.score).toEqual(score);
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeUndefined();
    const redone = history.redo()?.score ?? score;
    expect(redone).toEqual(first);
    const branched = history.apply(redone, retitle('Three')).score;
    expect(history.canRedo).toBe(false);
    expect(history.redo()).toBeUndefined();
    expect(branched.meta.title).toBe('Three');
    expect(second.meta.title).toBe('Two');
  });

  it('reports the patches an undo applied and the bars it touched', () => {
    const score = buildScore();
    const history = createHistory();
    const { change } = history.apply(
      score,
      setNote({ beatId: beatOf(score, 0, 2, 0).id }, { string: 2, fret: 9 }),
    );
    const undone = history.undo();
    expect(undone?.change).toEqual({ ...change, patches: change.inverse, inverse: change.patches });
  });

  it('undoes a grouped edit in one step, with nested groups flattened', () => {
    const score = buildScore();
    const history = createHistory();
    history.beginGroup('Paste bars');
    let current = score;
    for (let i = 0; i < 4; i++) {
      current = history.apply(current, insertBar({ index: 1 })).score;
      history.beginGroup('inner');
      current = history.apply(
        current,
        setMasterBar({ masterBarId: current.masterBars[1]?.id ?? '' }, { doubleBar: true }),
      ).score;
      history.endGroup();
    }
    history.endGroup();
    expect(current.masterBars).toHaveLength(8);
    expect(history.steps).toHaveLength(1);
    expect(history.undoLabel).toBe('Paste bars');

    const undone = history.undo();
    expect(undone?.score).toEqual(score);
    expect(undone?.change.command).toBe('Paste bars');
    expect(history.canUndo).toBe(false);
    expect(history.redo()?.score).toEqual(current);
  });

  it('records nothing for an empty group or a command that changed nothing', () => {
    const score = buildScore();
    const history = createHistory();
    history.beginGroup('Nothing');
    history.endGroup();
    const note = noteOf(score, 0, 2, 0);
    history.apply(
      score,
      setNote({ beatId: beatOf(score, 0, 2, 0).id }, { string: note.string, fret: note.fret }),
    );
    expect(history.canUndo).toBe(false);
  });

  it('keeps its state when a command is refused', () => {
    const score = buildScore();
    const history = createHistory();
    const titled = history.apply(score, retitle('One')).score;
    expect(() => history.apply(titled, removeBar({ masterBarId: 'nonexistent0' }))).toThrow(
      CommandError,
    );
    expect(history.undo()?.score).toEqual(score);
  });

  it('refuses misuse', () => {
    const score = buildScore();
    const history = createHistory();
    expect(() => {
      history.endGroup();
    }).toThrow(HistoryError);
    history.apply(score, retitle('One'));
    expect(() => history.apply(score, retitle('Two'))).toThrow(HistoryError);
    history.beginGroup('Open');
    expect(() => history.undo()).toThrow(HistoryError);
    expect(history.canUndo).toBe(false);
  });
});
