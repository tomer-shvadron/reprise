import { score, note } from '@reprise/model/testing';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { openTransposeDialog } from './transpose-commands';
import { setupEffects } from './test/effects';

const dialog = () => screen.getByRole('dialog', { name: 'Transpose' });
const closed = () =>
  waitFor(() => {
    expect(screen.queryByRole('dialog')).toBeNull();
  });
const field = (name: string) => within(dialog()).getByLabelText(name);

function twoTracks() {
  const built = score().key(0);
  built.track('guitar');
  built
    .bar()
    .beat('2', [note(1, 5)], { chord: { name: 'C' } })
    .beat('2', [note(2, 0)]);
  built.track('bass');
  built.bar().beat('1', [note(4, 0)]);
  return built.build({ ids: 'sequential' });
}

const frets = (services: Awaited<ReturnType<typeof setupEffects>>['services']) =>
  services.document
    .getState()
    .score?.tracks.map((track) =>
      track.bars.flatMap((bar) =>
        bar.voices[0].beats.flatMap((beat) => beat.notes.map((n) => n.fret)),
      ),
    );

describe('the Transpose dialog', () => {
  it('opens from the palette command on the current track, up one semitone', async () => {
    const { services } = await setupEffects();
    act(() => {
      openTransposeDialog(services);
    });
    expect(field('Semitones')).toHaveValue(1);
    expect(within(dialog()).getByText('Up 1 semitone')).toBeInTheDocument();
    expect(within(dialog()).getByRole('radio', { name: 'Current track' })).toBeChecked();
    expect(within(dialog()).getByRole('checkbox', { name: 'Transpose chord names' })).toBeChecked();
    expect(
      within(dialog()).getByRole('checkbox', { name: 'Adjust the key signature' }),
    ).toBeEnabled();
  });

  it('applies as one undo step labelled Transpose and remembers the amount', async () => {
    const { services, beats } = await setupEffects();
    const user = userEvent.setup();
    act(() => {
      openTransposeDialog(services);
    });
    const before = services.document.getState().revision;
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '2');
    expect(within(dialog()).getByText('Up 2 semitones')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await closed();
    expect(beats()[0]?.notes[0]?.fret).toBe(7);
    expect(beats()[3]?.notes[0]?.fret).toBe(4);
    expect(services.document.getState().revision).toBe(before + 1);
    expect(services.document.getState().undoLabel).toBe('Transpose');
    act(() => {
      services.document.getState().undo();
    });
    expect(beats()[0]?.notes[0]?.fret).toBe(5);
    act(() => {
      openTransposeDialog(services);
    });
    expect(field('Semitones')).toHaveValue(2);
  });

  it('disables Apply at zero and at an amount out of range', async () => {
    const { services } = await setupEffects();
    const user = userEvent.setup();
    act(() => {
      openTransposeDialog(services);
    });
    const apply = screen.getByRole('button', { name: 'Apply' });
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '0');
    expect(apply).toBeDisabled();
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '25');
    expect(field('Semitones')).toHaveAttribute('aria-invalid', 'true');
    expect(apply).toBeDisabled();
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '24');
    expect(apply).toBeEnabled();
  });

  it('keeps the dialog open with the sentence naming the note that would leave the neck', async () => {
    const { services, beats } = await setupEffects();
    const user = userEvent.setup();
    act(() => {
      openTransposeDialog(services);
    });
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '-1');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await within(dialog()).findByRole('alert')).toHaveTextContent(
      'Track 1, bar 1, string 3: fret 0 cannot go down 1 semitone without falling below the open string',
    );
    expect(services.entry.getState().message).toBeUndefined();
    expect(beats()[0]?.notes[0]?.fret).toBe(5);
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '1');
    expect(within(dialog()).queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await closed();
    expect(beats()[0]?.notes[0]?.fret).toBe(6);
  });

  it('offers the key only for a scope that covers every track, and Selection only with a target', async () => {
    const { services } = await setupEffects(undefined, twoTracks());
    const user = userEvent.setup();
    act(() => {
      services.selection.getState().setEdit({ cursor: undefined, selection: {} });
      openTransposeDialog(services);
    });
    const key = within(dialog()).getByRole('checkbox', { name: 'Adjust the key signature' });
    expect(within(dialog()).getByRole('radio', { name: 'Selection' })).toBeDisabled();
    expect(key).toBeDisabled();
    await user.click(within(dialog()).getByRole('radio', { name: 'All tracks' }));
    expect(key).toBeEnabled();
    expect(key).toBeChecked();
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '2');
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await closed();
    expect(services.document.getState().score?.masterBars[0]?.keySignature.fifths).toBe(2);
    expect(frets(services)).toEqual([[7, 2], [2]]);
  });

  it('moves chord names with the scope, spelled for the new key', async () => {
    const { services } = await setupEffects(undefined, twoTracks());
    const user = userEvent.setup();
    act(() => {
      openTransposeDialog(services);
    });
    await user.clear(field('Semitones'));
    await user.type(field('Semitones'), '2');
    await user.click(within(dialog()).getByRole('radio', { name: 'All tracks' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));
    await closed();
    const chord =
      services.document.getState().score?.tracks[0]?.bars[0]?.voices[0]?.beats[0]?.chord;
    expect(chord?.name).toBe('D');
  });

  it('shows Transposing… and disables the buttons while it applies', async () => {
    const { services, beats } = await setupEffects();
    const user = userEvent.setup();
    // The dialog applies a frame after showing it working. Hold that frame so the working state
    // lasts until the assertions have run, however slow the machine: user-event yields to the
    // event loop after a click, and under load the frame and the apply can both land in it.
    const frames: FrameRequestCallback[] = [];
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      act(() => {
        openTransposeDialog(services);
      });
      await user.click(screen.getByRole('button', { name: 'Apply' }));
      expect(screen.getByRole('button', { name: 'Transposing…' })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
      expect(screen.getByRole('dialog', { name: 'Transpose' })).toBeInTheDocument();
      // The held frame is what gates the apply, and it is the only one requested.
      expect(frames).toHaveLength(1);
      expect(beats()[0]?.notes[0]?.fret).toBe(5);
      act(() => {
        for (const frame of frames.splice(0)) frame(0);
      });
    } finally {
      raf.mockRestore();
    }
    await closed();
    expect(beats()[0]?.notes[0]?.fret).toBe(6);
  });

  it('says what Selection holds, and counts a whole-song range as covering every track for the key', async () => {
    const { services } = await setupEffects(undefined, twoTracks());
    const built = services.document.getState().score;
    const beatIds = built?.tracks.flatMap((track) =>
      track.bars.flatMap((bar) => bar.voices[0].beats.map((beat) => beat.id)),
    );
    act(() => {
      services.selection
        .getState()
        .setEdit({ selection: { beatIds: beatIds ?? [] }, cursor: undefined });
      openTransposeDialog(services);
    });
    const radio = within(dialog()).getByRole('radio', { name: 'Selection (3 beats)' });
    expect(radio).toBeChecked();
    expect(
      within(dialog()).getByRole('checkbox', { name: 'Adjust the key signature' }),
    ).toBeEnabled();
  });

  it('says so on the status line when a drum-only score has nothing to transpose', async () => {
    const built = score();
    built.track('drums');
    built.bar().beat('1', []);
    const { services } = await setupEffects(undefined, built.build({ ids: 'sequential' }));
    act(() => {
      openTransposeDialog(services);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(services.entry.getState().message).toBe('Drum tracks have no pitch to transpose');
  });
});
