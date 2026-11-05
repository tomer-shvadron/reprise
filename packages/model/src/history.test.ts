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

  it('names a removed bar and the bar that took its place, not the bars that only shifted', () => {
    const score = buildScore();
    const [, second, third] = score.masterBars.map((bar) => bar.id);
    const { change } = applyCommand(score, removeBar({ masterBarId: second ?? '' }));
    expect(change.touchedBars).toEqual([third, second]);
  });
});

describe('splice compaction', () => {
  const ops = (patches: readonly { op: string; path: (string | number)[] }[]): string[] =>
    patches.map((patch) => `${patch.op} ${patch.path.join('/')}`).sort();

  it('records a bar insert as one add per array, and undo keeps the other bars by identity', () => {
    const score = buildScore();
    const history = createHistory();
    const { score: after, change } = history.apply(score, insertBar({ index: 0 }));
    expect(ops(change.patches)).toEqual([
      'add masterBars/0',
      'add tracks/0/bars/0',
      'add tracks/1/bars/0',
      'replace masterBars/1',
      'replace tracks/0/lyrics/0/startBar',
    ]);
    // Applied to the longer score, so the old first bar gets its tempo back at index 0.
    expect(ops(change.inverse)).toEqual([
      'remove masterBars/0',
      'remove tracks/0/bars/0',
      'remove tracks/1/bars/0',
      'replace masterBars/0',
      'replace tracks/0/lyrics/0/startBar',
    ]);
    expect(applyPatches(score, change.patches)).toEqual(after);
    expect(applyPatches(after, change.inverse)).toEqual(score);
    const undone = history.undo()?.score;
    expect(undone?.tracks[1]?.bars[3]).toBe(score.tracks[1]?.bars[3]);
    expect(history.redo()?.score).toEqual(after);
  });

  it('keeps a replace for a shifted bar the command also edited', () => {
    const score = buildScore();
    const { score: after, change } = applyCommand(
      score,
      removeBar({ masterBarId: score.masterBars[0]?.id ?? '' }),
    );
    // The tie into the old bar 1 is released, so that bar is replaced where it lands.
    expect(ops(change.patches)).toEqual([
      'remove masterBars/0',
      'remove tracks/0/bars/0',
      'remove tracks/1/bars/0',
      'replace masterBars/0',
      'replace tracks/0/bars/0',
      'replace tracks/0/lyrics/0/startBar',
    ]);
    expect(applyPatches(score, change.patches)).toEqual(after);
    expect(applyPatches(after, change.inverse)).toEqual(score);
  });

  it('leaves a reorder as Immer wrote it', () => {
    const score = buildScore();
    const { change } = applyCommand(score, moveTrack({ trackId: score.tracks[1]?.id ?? '' }, 0));
    expect(ops(change.patches)).toEqual(['replace tracks/0', 'replace tracks/1']);
  });

  it('returns the same score when a command changed nothing', () => {
    const score = buildScore();
    const { score: same, change } = applyCommand(
      score,
      moveTrack({ trackId: score.tracks[0]?.id ?? '' }, 0),
    );
    expect(same).toBe(score);
    expect(change).toEqual({ command: 'moveTrack', patches: [], inverse: [], touchedBars: [] });
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
