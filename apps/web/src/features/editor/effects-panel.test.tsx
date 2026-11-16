import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { EffectsPanel } from './effects-panel';
import { setupEffects } from './test/effects';
import { must } from './test/must';

const button = (name: string | RegExp) => screen.getByRole('button', { name });

async function setup() {
  const made = await setupEffects(<EffectsPanel />);
  return { ...made, user: userEvent.setup() };
}

describe('the effects panel', () => {
  it('shows each toggle off, then pressed once applied, and applies on a click', async () => {
    const { services, user, beats } = await setup();
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'false');
    await user.click(button('Palm mute'));
    expect(beats()[0]?.notes[0]?.palmMute).toBe(true);
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'true');
    expect(services.document.getState().undoLabel).toBe('Palm mute');
    await user.click(button('Palm mute'));
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reads mixed when the notes disagree, and a press sets it on all of them', async () => {
    const { services, user, beats } = await setup();
    const first = must(beats()[1]?.notes[0]);
    act(() => {
      services.selection.getState().select({ noteIds: [first.id] });
    });
    await user.click(button('Palm mute'));
    const all = must(beats()[1]?.notes).map((n) => n.id);
    act(() => {
      services.selection.getState().select({ noteIds: all });
    });
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'mixed');
    await user.click(button('Palm mute'));
    expect(must(beats()[1]).notes.every((n) => n.palmMute)).toBe(true);
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'true');
  });

  it('follows the selection', async () => {
    const { services, user, goTo } = await setup();
    await user.click(button('Palm mute'));
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'true');
    goTo(2);
    expect(button('Palm mute')).toHaveAttribute('aria-pressed', 'false');
    expect(services.document.getState().score).toBeDefined();
  });

  it('puts a beat effect on the beat', async () => {
    const { user, beats } = await setup();
    await user.click(button('Tapping'));
    expect(beats()[0]?.effects.tapping).toBe(true);
    expect(button('Tapping')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Slap')).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables the effects that cannot apply here', async () => {
    const { services, goTo } = await setup();
    // The last note of the riff has no note to hammer to or slide to.
    goTo(0, 1, 1);
    expect(button('Hammer-on or pull-off')).toBeDisabled();
    act(() => {
      services.selection.getState().setEdit({ cursor: undefined });
    });
    expect(button('Palm mute')).toBeDisabled();
    expect(button('Bend…')).toBeDisabled();
    expect(button('Grace note…')).toBeDisabled();
    expect(screen.getByText('Select a note to apply effects.')).toBeInTheDocument();
  });

  it('disables everything outside edit mode and says how to turn it on', async () => {
    const { services } = await setup();
    act(() => {
      services.editing.getState().setEditing(false);
    });
    expect(button('Palm mute')).toBeDisabled();
    expect(button('Bend…')).toBeDisabled();
    expect(screen.getByText(/Turn on edit mode \(Ctrl\+E\) to apply effects/)).toBeInTheDocument();
  });

  it('opens a picker and returns focus to its button when it closes', async () => {
    const { user, beats } = await setup();
    const bend = button('Bend…');
    act(() => {
      bend.focus();
    });
    await user.keyboard('{Enter}');
    expect(screen.getByRole('dialog', { name: 'Bend' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(bend).toHaveFocus();
    await user.click(bend);
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Full bend' }));
    expect(beats()[0]?.notes[0]?.bend?.kind).toBe('bend');
    expect(bend).toHaveFocus();
  });

  it('opens the grace dialog', async () => {
    const { user } = await setup();
    await user.click(button('Grace note…'));
    expect(screen.getByRole('dialog', { name: 'Grace note' })).toBeInTheDocument();
  });

  it('does not take focus on a click, so typing carries on', async () => {
    const { user, press, beats } = await setup();
    await user.click(button('Accent'));
    expect(button('Accent')).not.toHaveFocus();
    expect(press('x')).toBe(true);
    expect(beats()[0]?.notes[0]?.dead).toBe(true);
  });

  it('is toggled from the palette command, showing and then hiding the right panel', async () => {
    const { services, registry } = await setup();
    const toggle = must(registry.get('editor.toggleEffectsPanel'));
    act(() => {
      void toggle.run();
    });
    expect(services.ui.getState()).toMatchObject({ rightPanelView: 'effects' });
    expect(services.ui.getState().panels.rightPanel).toBe(true);
    act(() => {
      void toggle.run();
    });
    expect(services.ui.getState().panels.rightPanel).toBe(false);
  });

  it('lets no key act on the score while one of its dialogs is open', async () => {
    const { user, press, beats } = await setup();
    await user.click(button('Bend…'));
    expect(press('p')).toBe(false);
    expect(beats()[0]?.notes[0]?.palmMute).toBe(false);
  });
});
