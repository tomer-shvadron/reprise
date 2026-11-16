import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { openGraceDialog } from './effect-dialogs';
import { setupEffects } from './test/effects';

const dialog = () => screen.getByRole('dialog', { name: 'Grace note' });
const field = (name: string) => within(dialog()).getByLabelText(name);

describe('the grace-note dialog', () => {
  it('opens on G before the beat and on Alt+G on the beat, with the default fret', async () => {
    const { press } = await setupEffects();
    expect(press('g')).toBe(true);
    expect(field('Fret')).toHaveValue(3);
    expect(field('Placement')).toHaveValue('before');
    expect(field('Length')).toHaveValue('32');
    await userEvent.keyboard('{Escape}');
    expect(press('g', { altKey: true })).toBe(true);
    expect(field('Placement')).toHaveValue('on');
  });

  it('applies the grace note as one undo step on Enter', async () => {
    const { services, press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('g');
    const before = services.document.getState().revision;
    await user.clear(field('Fret'));
    await user.type(field('Fret'), '4{Enter}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beats()[0]?.grace?.[0]).toMatchObject({ before: true, duration: 32 });
    expect(beats()[0]?.grace?.[0]?.notes[0]).toMatchObject({ string: 1, fret: 4 });
    expect(services.document.getState().revision).toBe(before + 1);
    expect(services.document.getState().undoLabel).toBe('Grace note');
    act(() => {
      services.document.getState().undo();
    });
    expect(beats()[0]?.grace).toBeUndefined();
  });

  it('opens prefilled on an existing grace note and removes it', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('g');
    await user.selectOptions(field('Length'), '16');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    press('g');
    expect(field('Length')).toHaveValue('16');
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beats()[0]?.grace).toBeUndefined();
  });

  it('stays open with the model sentence for a fret off the neck, and fixes on retry', async () => {
    const { press, beats } = await setupEffects();
    const user = userEvent.setup();
    press('g');
    await user.clear(field('Fret'));
    await user.type(field('Fret'), '60');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(dialog()).toBeInTheDocument();
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('That fret is not on the neck');
    expect(beats()[0]?.grace).toBeUndefined();
    await user.clear(field('Fret'));
    await user.type(field('Fret'), '3');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(beats()[0]?.grace).toHaveLength(1);
  });

  it('disables Apply on a fret that is not a whole number', async () => {
    const { press } = await setupEffects();
    const user = userEvent.setup();
    press('g');
    await user.clear(field('Fret'));
    expect(field('Fret')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('closes on Escape without a change, returning focus to its opener', async () => {
    const { services, beats } = await setupEffects();
    const user = userEvent.setup();
    const opener = document.createElement('button');
    document.body.append(opener);
    act(() => {
      openGraceDialog(services, true, opener);
    });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(beats()[0]?.grace).toBeUndefined();
  });

  it('does not open with nothing selected', async () => {
    const { services, press } = await setupEffects();
    act(() => {
      services.selection.getState().setEdit({ cursor: undefined });
    });
    expect(press('g')).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.entry.getState().message).toBe('Select a note first');
  });

  it('lets no key act on the score while it is open', async () => {
    const { press, beats } = await setupEffects();
    press('g');
    expect(press('p')).toBe(false);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
  });
});
