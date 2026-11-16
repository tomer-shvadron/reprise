import { note, score } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { dialogsOf } from './dialogs';
import { openEffectPicker } from './effect-dialogs';
import { setupEffects } from './test/effects';
import { must } from './test/must';

const dialog = () => screen.getByRole('dialog');

describe('the effect pickers', () => {
  it('open on their keys and name themselves', async () => {
    const { press } = await setupEffects();
    expect(press('b')).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Bend' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(press('s', { shiftKey: true })).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Slide' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(press('y', { altKey: true })).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Harmonic' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(press('v', { altKey: true })).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Whammy bar' })).toBeInTheDocument();
  });

  it('applies a bend as one undo step with its label, and closes', async () => {
    const { services, press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('b');
    const before = services.document.getState().revision;
    await user.click(within(dialog()).getByRole('button', { name: 'Full bend and release' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beats()[0]?.notes[0]?.bend?.kind).toBe('bendRelease');
    expect(services.document.getState().revision).toBe(before + 1);
    expect(services.document.getState().undoLabel).toBe('Full bend and release');
    act(() => {
      services.document.getState().undo();
    });
    expect(beats()[0]?.notes[0]?.bend).toBeUndefined();
  });

  it('opens on the value the target has, and Remove clears it', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('b');
    await user.click(within(dialog()).getByRole('button', { name: '½ prebend' }));
    press('b');
    expect(within(dialog()).getByRole('button', { name: '½ prebend' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog()).getByRole('button', { name: 'Full bend' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await user.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beats()[0]?.notes[0]?.bend).toBeUndefined();
  });

  it('moves with the arrows and applies on Enter', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('s', { shiftKey: true });
    const first = within(dialog()).getByRole('button', { name: 'Shift slide' });
    act(() => {
      first.focus();
    });
    await user.keyboard('{ArrowRight}');
    expect(within(dialog()).getByRole('button', { name: 'Legato slide' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beats()[0]?.notes[0]?.slide).toEqual(['legato']);
  });

  it('toggles a slide kind off again and respects the exclusive groups', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('s', { shiftKey: true });
    await user.click(within(dialog()).getByRole('button', { name: 'Out down' }));
    press('s', { shiftKey: true });
    await user.click(within(dialog()).getByRole('button', { name: 'Out up' }));
    expect(beats()[0]?.notes[0]?.slide).toEqual(['outUp']);
    press('s', { shiftKey: true });
    await user.click(within(dialog()).getByRole('button', { name: 'Out up' }));
    expect(beats()[0]?.notes[0]?.slide).toBeUndefined();
  });

  it('puts the harmonic on the note with the node chosen', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('y', { altKey: true });
    const node = within(dialog()).getByLabelText('Node above the fretted note (frets)');
    await user.clear(node);
    await user.type(node, '7');
    await user.click(within(dialog()).getByRole('button', { name: 'Artificial' }));
    expect(beats()[0]?.notes[0]?.harmonic).toEqual({ kind: 'artificial', value: 7 });
    press('y', { altKey: true });
    await user.click(within(dialog()).getByRole('button', { name: 'Remove' }));
    expect(beats()[0]?.notes[0]?.harmonic).toBeUndefined();
  });

  it('puts a whammy preset on the beat', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('v', { altKey: true });
    await user.click(within(dialog()).getByRole('button', { name: 'Whole step dive' }));
    expect(beats()[0]?.effects.whammy?.kind).toBe('dive');
  });

  it('keeps open and says why when the target refuses, and never opens on an empty one', async () => {
    // A prebend cannot go on a tied note.
    const built = score().track('guitar');
    built.bar().beat('2', [note(4, 2)]);
    built.bar().beat('2', [note(4, 2, { tie: true })]);
    const { services, press, goTo } = await setupEffects(
      undefined,
      built.build({ ids: 'sequential' }),
    );
    const user = userEvent.setup();
    goTo(0, 4, 1);
    press('b');
    await user.click(within(dialog()).getByRole('button', { name: '½ prebend' }));
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(/tied note continues its bend/i);
    const tied = must(services.document.getState().score).tracks[0]?.bars[1]?.voices[0]?.beats[0];
    expect(tied?.notes[0]?.bend).toBeUndefined();
    await user.keyboard('{Escape}');
    // Nothing selected: the picker stays shut and the status line says why.
    act(() => {
      services.selection.getState().setEdit({ cursor: undefined });
    });
    expect(press('b')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.entry.getState().message).toBe('Select a note first');
  });

  it('returns focus to the control that opened it, and does so on Escape too', async () => {
    const { services } = await setupEffects();
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    act(() => {
      openEffectPicker(services, 'bend', opener);
    });
    expect(dialogsOf(services).getState().dialog).toEqual({ kind: 'effectPicker', picker: 'bend' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    act(() => {
      openEffectPicker(services, 'bend', opener);
    });
    await user.click(within(dialog()).getByRole('button', { name: 'Full bend' }));
    expect(opener).toHaveFocus();
  });

  it('lets no key act on the score while a picker is open', async () => {
    const { press, beats } = await setupEffects();
    press('b');
    expect(press('p')).toBe(false);
    expect(press('7')).toBe(false);
    expect(press('g')).toBe(false);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
    expect(beats()[0]?.notes[0]?.fret).toBe(5);
  });
});
