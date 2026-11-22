import { setNote } from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { fakePlatform } from '@/test/services';

import { createDocumentStore } from './document';
import { installHistoryMenu } from './history-menu';

function setup() {
  const setHistoryLabels = vi.fn();
  const platform = fakePlatform({ setHistoryLabels });
  const document = createDocumentStore({ platform });
  document.getState().newDocument(
    score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0)])
      .build(),
  );
  const edit = (fret: number) => {
    const current = document.getState().score;
    if (!current) throw new Error('no score');
    document
      .getState()
      .apply(setNote({ beatId: beatOf(current, 0, 0, 0).id }, { string: 1, fret }));
  };
  return { document, setHistoryLabels, platform, edit };
}

describe('installHistoryMenu', () => {
  it('reports empty stacks first, then the newest labels on each change', () => {
    const { document, setHistoryLabels, platform, edit } = setup();
    installHistoryMenu(document, platform);
    expect(setHistoryLabels).toHaveBeenLastCalledWith({});

    edit(2);
    expect(setHistoryLabels).toHaveBeenLastCalledWith({ undo: 'setNote' });

    document.getState().undo();
    expect(setHistoryLabels).toHaveBeenLastCalledWith({ redo: 'setNote' });
  });

  it('pushes the labels once for a history jump', () => {
    const { document, setHistoryLabels, platform, edit } = setup();
    installHistoryMenu(document, platform);
    edit(2);
    edit(3);
    edit(4);
    setHistoryLabels.mockClear();
    document.getState().step(-3);
    expect(setHistoryLabels).toHaveBeenCalledTimes(1);
    expect(setHistoryLabels).toHaveBeenLastCalledWith({ redo: 'setNote' });
  });

  it('maps each name through display before pushing', () => {
    const { document, setHistoryLabels, platform, edit } = setup();
    installHistoryMenu(document, platform, (name) => `<${name}>`);

    edit(2);
    document.getState().undo();

    expect(setHistoryLabels).toHaveBeenLastCalledWith({ redo: '<setNote>' });
  });

  it('stays quiet when only a deeper entry changes, or an unrelated field does', () => {
    const { document, setHistoryLabels, platform, edit } = setup();
    installHistoryMenu(document, platform);
    edit(2);
    const calls = setHistoryLabels.mock.calls.length;

    edit(3);
    document.getState().setWarningsOpen(true);

    expect(setHistoryLabels).toHaveBeenCalledTimes(calls);
  });

  it('does nothing without a platform menu, and stops after the undo', () => {
    const { document, setHistoryLabels, platform, edit } = setup();
    const noMenu = installHistoryMenu(document, fakePlatform());
    expect(noMenu).toBeTypeOf('function');
    noMenu();

    const stop = installHistoryMenu(document, platform);
    stop();
    edit(2);

    expect(setHistoryLabels).toHaveBeenCalledTimes(1);
  });
});
