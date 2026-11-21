import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createTestServices, fakePlatform } from '@/test/services';

import { DEFAULT_SOUND_SETTINGS, EMILYGUITAR_FIVE_VOICES } from './default-sounds';
import { packContents, syntheticManifest, zipFileOf, zipOf } from './test/pack-fixtures';
import { soundsSection } from './sounds-section';

const { Component: Sounds } = soundsSection;

async function setup(withDownload = false) {
  const services = createTestServices(
    withDownload
      ? { platform: fakePlatform({ download: () => Promise.reject(new Error('not used')) }) }
      : {},
  );
  await services.settings.whenHydrated();
  await act(async () => {
    await services.sounds.scan();
  });
  renderWithServices(<Sounds />, services);
  return { services, user: userEvent.setup() };
}

describe('the Sounds section', () => {
  it('has one row per family, both guitar families on Emilyguitar by default', async () => {
    await setup();
    for (const label of ['Electric guitar', 'Acoustic guitar', 'Bass', 'Drums', 'Keys']) {
      expect(screen.getByRole('combobox', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'Electric guitar' })).toHaveValue('missing');
    expect(screen.getByRole('combobox', { name: 'Bass' })).toHaveValue('gm');
  });

  it('writes the handle of the row, and acoustic goes back to General MIDI on its own', async () => {
    const { services, user } = await setup();
    const zip = zipFileOf('pack.zip', await zipOf(packContents()));
    await act(async () => {
      await services.sounds.installZip(zip, syntheticManifest());
      await services.sounds.scan();
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Bass' }), 'Synthetic Pack: Alt');
    expect(services.settings.get(DEFAULT_SOUND_SETTINGS.bass)).toEqual({
      packId: 'SynthPack001',
      instrument: 'alt',
    });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Acoustic guitar' }), 'gm');
    expect(services.settings.get(DEFAULT_SOUND_SETTINGS['acoustic-guitar'])).toBe('gm');
    expect(services.settings.get(DEFAULT_SOUND_SETTINGS['electric-guitar'])).toEqual(
      EMILYGUITAR_FIVE_VOICES,
    );
  });

  it('offers Open Sounds for a pack that is not installed, without a direct download', async () => {
    const { services, user } = await setup();
    const row = screen.getByRole('combobox', { name: 'Electric guitar' }).parentElement;
    if (!row) throw new Error('no row');
    expect(within(row).queryByRole('button', { name: 'Download' })).toBeNull();
    await user.click(within(row).getAllByRole('button', { name: 'Open Sounds' })[0] ?? row);
    expect(services.ui.getState().sheet).toBe('sounds');
  });

  it('says in the row description that a stored pack is not installed', async () => {
    await setup();
    const select = screen.getByRole('combobox', { name: 'Electric guitar' });
    expect(select).toHaveAccessibleDescription('Not installed: plays General MIDI.');
    expect(
      within(select).getByRole('option', { name: 'Karoryfer Emilyguitar: Five voices' }),
    ).toBeInTheDocument();
  });

  it('offers Download with a platform that downloads', async () => {
    await setup(true);
    const row = screen.getByRole('combobox', { name: 'Electric guitar' }).parentElement;
    if (!row) throw new Error('no row');
    expect(within(row).getByRole('button', { name: 'Download' })).toBeVisible();
  });
});
