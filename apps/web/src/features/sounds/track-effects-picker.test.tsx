import { write } from '@reprise/formats';
import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { TrackEffectsPicker } from './track-effects-picker';

async function setup(program = 30) {
  const services = createTestServices();
  mirrorAudio(services);
  const song = score().track('guitar', { name: 'Lead', program }).build();
  const { bytes } = await write(song, 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const track = services.document.getState().score?.tracks[0];
  if (!track) throw new Error('no track');
  renderWithServices(<TrackEffectsPicker trackId={track.id} label="Lead" />, services);
  const select = screen.getByRole('combobox', { name: 'Effects of Lead' });
  const sound = () => services.document.getState().score?.tracks[0]?.sound;
  return { services, select, sound, user: userEvent.setup() };
}

describe('TrackEffectsPicker', () => {
  it('lists Automatic, the family presets, fuzz and off', async () => {
    const { select } = await setup();
    const labels = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels[0]).toBe('Automatic (off on GM sounds)');
    expect(labels.slice(1)).toEqual([
      'Clean',
      'Overdrive',
      'Distortion',
      'Acoustic',
      'Bass',
      'Keys',
      'Drums',
      'Other',
      'Fuzz',
      'Off',
    ]);
    expect(select).toHaveValue('');
  });

  it('names the family automatic resolves to once the GM tier bypass is off', async () => {
    const { services } = await setup();
    act(() => {
      services.audio.setGmTierBypass(false);
    });
    expect(screen.getByRole('option', { name: 'Automatic (Distortion)' })).toBeInTheDocument();
  });

  it('stores the chosen preset in the score and undoes it', async () => {
    const { services, select, sound, user } = await setup();
    await user.selectOptions(select, 'fuzz');
    expect(sound()).toEqual({ preset: 'fuzz' });
    expect(select).toHaveValue('fuzz');

    act(() => {
      services.document.getState().undo();
    });
    expect(sound()).toBeUndefined();
    expect(select).toHaveValue('');
  });

  it('removes the preset for Automatic and keeps the rest of the sound', async () => {
    const { services, select, sound, user } = await setup();
    await user.selectOptions(select, 'clean');
    expect(sound()).toEqual({ preset: 'clean' });
    await user.selectOptions(select, 'Automatic (off on GM sounds)');
    expect(sound()).toBeUndefined();
    expect(select).toHaveValue('');
    act(() => {
      services.document.getState().undo();
    });
    expect(sound()).toEqual({ preset: 'clean' });
  });

  it('keeps the pack assignment when Automatic removes the preset', async () => {
    const { services, select, sound, user } = await setup();
    const id = services.document.getState().score?.tracks[0]?.id ?? '';
    act(() => {
      services.document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: id },
            { sound: { packId: 'pack000000a1', preset: 'clean' } },
          ),
        );
    });
    await user.selectOptions(select, '');
    expect(sound()).toEqual({ packId: 'pack000000a1' });
  });

  it('writes no sound-override loss to gp for a track set back to Automatic', async () => {
    const { services, select, user } = await setup();
    await user.selectOptions(select, 'clean');
    await user.selectOptions(select, '');
    const song = services.document.getState().score;
    if (!song) throw new Error('no score');
    const { dropped } = await write(song, 'gp');
    expect(dropped.filter((entry) => entry.code === 'sound-override')).toEqual([]);
  });

  it('shows an id the engine does not know as Automatic', async () => {
    const { services, select } = await setup();
    const { score: current } = services.document.getState();
    const id = current?.tracks[0]?.id ?? '';
    act(() => {
      services.document
        .getState()
        .apply(setTrackProperties({ trackId: id }, { sound: { preset: 'from-the-future' } }));
    });
    expect(select).toHaveValue('');
  });
});
