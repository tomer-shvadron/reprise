import { write } from '@reprise/formats';
import { setTrackProperties } from '@reprise/model';
import { score } from '@reprise/model/testing';
import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices } from '@/test/services';

import { packContents, syntheticManifest, zipFileOf, zipOf } from './test/pack-fixtures';
import { TrackSoundPicker } from './track-sound-picker';

async function setup(kind: 'fretted' | 'drums' = 'fretted', program = 33) {
  const services = createTestServices();
  const song = score()
    .track(kind === 'drums' ? 'drums' : 'bass', { name: 'Bass', program })
    .build();
  const { bytes } = await write(song, 'reprise');
  await act(async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
  });
  const id = services.document.getState().score?.tracks[0]?.id ?? '';
  const zip = zipFileOf('pack.zip', await zipOf(packContents()));
  await act(async () => {
    await services.sounds.installZip(zip, syntheticManifest());
  });
  renderWithServices(
    <TrackSoundPicker trackId={id} label="Bass" generalMidi="Electric Bass (finger)" />,
    services,
  );
  const select = screen.getByRole('combobox', { name: 'Sound of Bass' });
  const sound = () => services.document.getState().score?.tracks[0]?.sound;
  return { services, id, select, sound, user: userEvent.setup() };
}

describe('TrackSoundPicker', () => {
  it('lists General MIDI, then the packs that suit the track, one option per instrument', async () => {
    const { select } = await setup();
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'General MIDI (Electric Bass (finger))',
      'Synthetic Pack: Default',
      'Synthetic Pack: Alt',
    ]);
    expect(within(select).getByRole('group', { name: 'Suggested' })).toBeInTheDocument();
    expect(select).toHaveValue('');
  });

  it('puts a pack that does not suit the track under Other packs', async () => {
    const { select } = await setup('drums', 0);
    expect(within(select).getByRole('group', { name: 'Packs' })).toBeInTheDocument();
    expect(within(select).queryByRole('group', { name: 'Suggested' })).toBeNull();
  });

  it('stores a choice as one undoable edit, and General MIDI drops the sound again', async () => {
    const { services, select, sound, user } = await setup();
    await user.selectOptions(select, 'Synthetic Pack: Alt');
    expect(sound()).toEqual({ packId: 'SynthPack001', instrument: 'alt' });
    act(() => {
      services.document.getState().undo();
    });
    expect(sound()).toBeUndefined();
    act(() => {
      services.document.getState().redo();
    });

    await user.selectOptions(select, 'General MIDI (Electric Bass (finger))');
    expect(sound()).toBeUndefined();
    act(() => {
      services.document.getState().undo();
    });
    expect(sound()).toEqual({ packId: 'SynthPack001', instrument: 'alt' });
    expect(select).toHaveValue('SynthPack001/alt');
  });

  it('keeps the effects preset when General MIDI drops the pack', async () => {
    const { services, id, select, sound, user } = await setup();
    act(() => {
      services.document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: id },
            { sound: { packId: 'SynthPack001', preset: 'clean' } },
          ),
        );
    });
    expect(select).toHaveValue('SynthPack001/default');
    await user.selectOptions(select, '');
    expect(sound()).toEqual({ preset: 'clean' });
  });

  it('shows a pack that is not installed as selected, with a notice', async () => {
    const { services, id, select, sound } = await setup();
    act(() => {
      services.document
        .getState()
        .apply(setTrackProperties({ trackId: id }, { sound: { packId: 'Gone00000001' } }));
    });
    expect(select).toHaveValue('missing');
    expect(
      screen.getByRole('option', { name: 'Gone00000001 (not installed)' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Gone00000001 is not installed: playing General MIDI')).toBeVisible();
    expect(sound()).toEqual({ packId: 'Gone00000001' });
  });

  it('reports an instrument the installed pack lacks', async () => {
    const { services, id } = await setup();
    act(() => {
      services.document
        .getState()
        .apply(
          setTrackProperties(
            { trackId: id },
            { sound: { packId: 'SynthPack001', instrument: 'nope' } },
          ),
        );
    });
    expect(
      screen.getByText('Synthetic Pack: nope is not installed: playing General MIDI'),
    ).toBeVisible();
  });

  it('shows the engine message of a pack that failed to load', async () => {
    const { services, id } = await setup();
    act(() => {
      services.playback.setState({
        trackSounds: {
          [id]: { tier: 'gm', packId: 'SynthPack001', problem: 'failed', message: 'no regions' },
        },
      });
    });
    expect(
      screen.getByText('The sound pack could not be loaded: playing General MIDI (no regions)'),
    ).toBeVisible();
  });
});
