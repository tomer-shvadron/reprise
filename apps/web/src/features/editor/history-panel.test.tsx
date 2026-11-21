import { write } from '@reprise/formats';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { copySelection, pasteClip } from './clipboard-actions';
import { HistoryPanel } from './history-panel';
import { insertBar, setNote } from '@reprise/model';
import { clipboardScore, cursorAt } from './test/clip-scores';
import { must } from './test/must';

async function setup() {
  const services = createTestServices();
  await services.document
    .getState()
    .openBytes('history.reprise', (await write(clipboardScore(), 'reprise')).bytes);
  renderWithServices(<HistoryPanel />, services);
  const doc = services.document;
  const score = () => must(doc.getState().score, 'score');
  const edit = () => {
    act(() => {
      doc.getState().apply(insertBar({ index: 1 }));
    });
    const rest = must(score().tracks[0]?.bars[2]?.voices[0]?.beats[0]).id;
    act(() => {
      doc.getState().apply(setNote({ beatId: rest }, { string: 2, fret: 3 }));
    });
  };
  return { services, doc, score, edit, user: userEvent.setup() };
}

const rows = () => screen.getAllByRole('option').map((row) => row.textContent);

describe('the history panel', () => {
  it('says there are no changes yet, with the start row only', async () => {
    await setup();
    expect(screen.getByText('No changes yet')).toBeTruthy();
    expect(rows()).toEqual(['Opened']);
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Redo' })).toHaveProperty('disabled', true);
  });

  it('shows the Undo and Redo keys as caps on focus, and a click still undoes', async () => {
    const { edit, doc, user } = await setup();
    edit();
    act(() => {
      screen.getByRole('button', { name: 'Undo Edit note' }).focus();
    });
    await screen.findByRole('tooltip');
    const caps = [...document.querySelectorAll('[data-slot=tooltip-content] [data-slot=kbd]')].map(
      (cap) => cap.textContent,
    );
    expect(caps).toEqual(['Ctrl', 'Z']);
    expect(screen.getByRole('button', { name: 'Undo Edit note' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Z',
    );
    await user.click(screen.getByRole('button', { name: 'Undo Edit note' }));
    expect(doc.getState().historyLabels.undo).toHaveLength(1);
  });

  it('lists the edits oldest first, marks the current one and carries the labels on the buttons', async () => {
    const { edit, doc } = await setup();
    edit();
    expect(rows()).toEqual(['Opened', 'Insert bar', 'Edit note']);
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Undo Edit note' })).toBeTruthy();
    act(() => {
      doc.getState().undo();
    });
    expect(rows()).toEqual(['Opened', 'Insert bar', 'Edit note']);
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('button', { name: 'Undo Insert bar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Redo Edit note' })).toBeTruthy();
  });

  it('steps back to a clicked row with repeated undo, and forward to a redo row with redo', async () => {
    const { edit, doc, user } = await setup();
    edit();
    const before = doc.getState().historyLabels;
    expect(before.undo).toHaveLength(2);
    await user.click(screen.getAllByRole('option')[0] as HTMLElement);
    expect(doc.getState().historyLabels.undo).toHaveLength(0);
    expect(doc.getState().historyLabels.redo).toHaveLength(2);
    await user.click(screen.getAllByRole('option')[2] as HTMLElement);
    expect(doc.getState().historyLabels.undo).toHaveLength(2);
    expect(doc.getState().historyLabels.redo).toHaveLength(0);
    await user.click(screen.getAllByRole('option')[1] as HTMLElement);
    expect(doc.getState().historyLabels.undo).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Redo Edit note' }));
    expect(doc.getState().historyLabels.undo).toHaveLength(2);
  });

  it('shows a paste as one Paste row', async () => {
    const { services, score, doc } = await setup();
    services.editing.getState().setEditing(true);
    const goTo = (track: number, bar: number, stop: number) => {
      const cursor = cursorAt(score(), track, bar, stop);
      act(() => {
        services.selection.getState().setEdit({ cursor, currentTrack: cursor.track });
      });
    };
    goTo(0, 0, 0);
    const clip = must(copySelection(services));
    goTo(1, 2, 0);
    act(() => {
      pasteClip(services, clip, 'overwrite');
    });
    expect(rows()).toEqual(['Opened', 'Paste']);
    expect(doc.getState().historyLabels.undo).toHaveLength(1);
  });

  it('moves with the arrows, is one tab stop, and jumps on Enter and Space', async () => {
    const { edit, doc, user } = await setup();
    edit();
    const options = () => screen.getAllByRole('option');
    // The current row is the one tab stop.
    expect(options().map((row) => row.tabIndex)).toEqual([-1, -1, 0]);
    await user.tab();
    await user.tab();
    expect(options()[2]).toBe(document.activeElement);
    await user.keyboard('{ArrowUp}');
    expect(options()[1]).toBe(document.activeElement);
    expect(options().map((row) => row.tabIndex)).toEqual([-1, 0, -1]);
    await user.keyboard('{Home}');
    expect(options()[0]).toBe(document.activeElement);
    await user.keyboard('{Enter}');
    expect(doc.getState().historyLabels.undo).toHaveLength(0);
    await user.keyboard('{End}');
    expect(options()[2]).toBe(document.activeElement);
    await user.keyboard(' ');
    expect(doc.getState().historyLabels.undo).toHaveLength(2);
    await user.keyboard('{ArrowDown}');
    expect(options()[2]).toBe(document.activeElement);
  });
});

describe('the history panel start row', () => {
  it('reads New song for a document made in the app', () => {
    const services = createTestServices();
    renderWithServices(<HistoryPanel />, services);
    act(() => {
      services.document.getState().newDocument(clipboardScore());
    });
    expect(rows()).toEqual(['New song']);
  });
});
