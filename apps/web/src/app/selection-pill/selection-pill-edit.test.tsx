import { write } from '@reprise/formats';
import type { Anchor } from '@reprise/layout';
import type { Score } from '@reprise/model';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { dialogsOf } from '@/features/editor/dialogs';
import { editScore } from '@/features/editor/test/scores';
import { stubViewport } from '@/features/score/test/viewport-stub';
import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { ScorePane } from '../score-pane';

vi.mock('@/features/score/fonts', () => ({
  useScoreFonts: () => true,
  loadScoreFonts: () => Promise.resolve(),
}));

async function setup() {
  stubViewport(1280, 800);
  const services = createTestServices();
  mirrorAudio(services);
  renderWithServices(<ScorePane hint={null} />, services);
  const built: Score = { ...editScore(), meta: { ...editScore().meta, title: 'Edit' } };
  await act(async () => {
    await services.document
      .getState()
      .openBytes('edit.reprise', (await write(built, 'reprise')).bytes);
  });
  const opened = services.document.getState().score;
  const result = services.layout.getState().result;
  if (!opened || !result) throw new Error('not open');
  act(() => {
    services.editing.getState().setEditing(true);
  });
  const canvas = () => {
    const found = screen
      .getByRole('region', { name: 'Score: Edit' })
      .querySelector<HTMLElement>('.score-canvas');
    if (!found) throw new Error('no canvas');
    return found;
  };
  const noteAt = (bar: number, beat: number, shiftKey = false) => {
    const id = opened.tracks[0]?.bars[bar]?.voices[0]?.beats[beat]?.notes[0]?.id;
    const anchor: Anchor | undefined = result.anchors.find((a) => a.kind === 'note' && a.id === id);
    if (!anchor) throw new Error('no note anchor');
    return {
      clientX: anchor.bbox.x + anchor.bbox.width / 2,
      clientY: anchor.bbox.y + anchor.bbox.height / 2,
      button: 0,
      shiftKey,
    };
  };
  const click = (at: ReturnType<typeof noteAt>) => {
    fireEvent.pointerDown(canvas(), at);
    fireEvent.pointerUp(canvas(), at);
  };
  return { services, score: opened, result, canvas, noteAt, click };
}

const toolbar = () => screen.getByRole('toolbar');
const button = (name: string | RegExp) => within(toolbar()).getByRole('button', { name });

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('the selection pill in edit mode', () => {
  it('shows over the clicked note with the edit items, named for the note', async () => {
    const { noteAt, click } = await setup();
    click(noteAt(1, 1));
    expect(toolbar()).toHaveAccessibleName(/^Note, bar 2/);
    const names = within(toolbar())
      .getAllByRole('button')
      .map((each) => each.getAttribute('aria-label'));
    expect(names[0]).toMatch(/^Duration, /);
    expect(names).toContain('More actions');
    for (const letter of ['H', 'S', 'B', 'V', 'P']) {
      expect(within(toolbar()).getByText(letter)).toBeInTheDocument();
    }
    // Neither the play items nor Focus.
    expect(screen.queryByRole('button', { name: 'Focus on loop' })).toBeNull();
  });

  it('disables an effect the note cannot take, with the effects panel’s reason', async () => {
    const { noteAt, click } = await setup();
    click(noteAt(1, 1));
    const hammer = within(toolbar()).getByText('H').closest('button');
    expect(hammer).toBeDisabled();
    expect(hammer).toHaveAccessibleDescription(/Nothing to hammer to/);
  });

  it('presses the effect toggles from the effects state, and a click sets one without moving focus', async () => {
    const { noteAt, click } = await setup();
    click(noteAt(1, 1));
    const region = screen.getByRole('region', { name: 'Score: Edit' });
    region.focus();
    const hammer = within(toolbar()).getByText('V').closest('button');
    if (!hammer) throw new Error('no V');
    const before = hammer.getAttribute('aria-pressed');
    expect(before).not.toBe('true');
    expect(fireEvent.mouseDown(hammer)).toBe(false);
    fireEvent.click(hammer);
    expect(hammer).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(region);
  });

  it('presses Dot and Triplet from the entry rhythm', async () => {
    const { services, noteAt, click } = await setup();
    click(noteAt(1, 1));
    expect(button('Toggle dot')).toHaveAttribute('aria-pressed', 'false');
    act(() => {
      services.entry.getState().setRhythm({ duration: 4, dots: 1, tuplet: undefined });
    });
    expect(button('Toggle dot')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Toggle triplet')).toHaveAttribute('aria-pressed', 'false');
    act(() => {
      services.entry.getState().setRhythm({ duration: 8, dots: 0, tuplet: { n: 3, of: 2 } });
    });
    expect(button('Toggle triplet')).toHaveAttribute('aria-pressed', 'true');
  });

  it('opens the bend dialog from B', async () => {
    const { services, noteAt, click } = await setup();
    click(noteAt(1, 1));
    const bend = within(toolbar()).getByText('B').closest('button');
    if (!bend) throw new Error('no B');
    expect(bend).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(bend);
    expect(dialogsOf(services).getState().dialog).toMatchObject({
      kind: 'effectPicker',
      picker: 'bend',
    });
  });

  it('opens the duration menu with the status bar’s steps', async () => {
    const user = userEvent.setup();
    const { noteAt, click } = await setup();
    click(noteAt(1, 1));
    const trigger = button(/^Duration, /);
    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((each) => each.textContent);
    expect(items).toHaveLength(5);
    for (const [index, label] of [
      'Longer',
      'Shorter',
      'Dotted',
      'Double dotted',
      'Triplet',
    ].entries()) {
      expect(items[index]).toContain(label);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull();
    });
    // Escape in the menu is Radix's: the pill neither moved focus nor was hidden.
    expect(document.querySelector('[data-selection-pill]')).not.toHaveAttribute('hidden');
  });

  it('anchors on the range after a Shift+click, and hides while a drag is unfinished', async () => {
    const { services, canvas, noteAt, click } = await setup();
    click(noteAt(0, 0));
    click(noteAt(0, 3, true));
    expect(services.selection.getState().range).toBeDefined();
    expect(screen.queryByRole('toolbar')).not.toBeNull();
    const from = noteAt(1, 1);
    fireEvent.pointerDown(canvas(), from);
    fireEvent.pointerMove(canvas(), { ...from, clientX: from.clientX + 10 });
    fireEvent.pointerMove(canvas(), noteAt(0, 3));
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.pointerUp(canvas(), noteAt(0, 3));
    expect(screen.queryByRole('toolbar')).not.toBeNull();
  });

  it('hides while a fret digit waits for its second digit', async () => {
    const { services, noteAt, click } = await setup();
    click(noteAt(1, 1));
    const cursor = services.selection.getState().cursor;
    if (!cursor) throw new Error('no cursor');
    act(() => {
      services.entry.getState().setPending({ fret: 1, cursor });
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('keeps Escape from clearing the range', async () => {
    const user = userEvent.setup();
    const { services, noteAt, click } = await setup();
    click(noteAt(0, 0));
    click(noteAt(0, 3, true));
    act(() => {
      button('More actions').focus();
    });
    await user.keyboard('{Escape}');
    expect(services.selection.getState().range).toBeDefined();
  });
});
