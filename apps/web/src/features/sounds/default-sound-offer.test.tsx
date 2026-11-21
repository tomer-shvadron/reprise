import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { renderWithServices } from '@/test/render';
import { createMemorySettingsBackend, createTestSettings } from '@/test/settings-backend';
import { createTestServices, fakePlatform } from '@/test/services';

import { DefaultSoundOffer } from './default-sound-offer';
import { EMILYGUITAR_FIVE_VOICES, OFFERED_PACKS_SETTING } from './default-sounds';

const missing = {
  'track-1': {
    tier: 'gm',
    packId: EMILYGUITAR_FIVE_VOICES.packId,
    problem: 'missing',
    source: 'default',
  },
} as const;

async function launch(backend = createMemorySettingsBackend(), download = false) {
  const services = createTestServices({
    settings: createTestSettings(backend),
    ...(download && {
      platform: fakePlatform({ download: () => Promise.reject(new Error('not used')) }),
    }),
  });
  await services.settings.whenHydrated();
  renderWithServices(<DefaultSoundOffer />, services);
  return { services, user: userEvent.setup() };
}

const scanAndMiss = async (services: Awaited<ReturnType<typeof launch>>['services']) => {
  await act(async () => {
    await services.sounds.scan();
  });
  act(() => {
    services.playback.setState({ trackSounds: missing });
  });
};

describe('the default sound offer', () => {
  it('is not shown before the scan, or when no track defaults to a missing pack', async () => {
    const { services } = await launch();
    act(() => {
      services.playback.setState({ trackSounds: missing });
    });
    expect(screen.queryByText(/free .* download/)).toBeNull();
    await act(async () => {
      await services.sounds.scan();
    });
    act(() => {
      services.playback.setState({ trackSounds: {} });
    });
    expect(screen.queryByText(/free .* download/)).toBeNull();
  });

  it('shows once per pack id, even across a relaunch', async () => {
    const backend = createMemorySettingsBackend();
    const first = await launch(backend);
    await scanAndMiss(first.services);
    expect(await screen.findByText(/Karoryfer Emilyguitar, a free .* download/)).toBeVisible();
    expect(first.services.settings.get(OFFERED_PACKS_SETTING)).toEqual(['qxmLveBRBWt8']);
    await first.user.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText(/free .* download/)).toBeNull();
    await act(async () => {});

    document.body.innerHTML = '';
    const second = await launch(backend);
    await scanAndMiss(second.services);
    expect(screen.queryByText(/free .* download/)).toBeNull();
  });

  it('offers Open Sounds on the web', async () => {
    const { services, user } = await launch();
    await scanAndMiss(services);
    await user.click(await screen.findByRole('button', { name: 'Open Sounds' }));
    expect(services.ui.getState().sheet).toBe('sounds');
  });

  it('downloads the curated pack on the desktop', async () => {
    const { services, user } = await launch(createMemorySettingsBackend(), true);
    await scanAndMiss(services);
    const install = services.sounds.installCurated.bind(services.sounds);
    let installed: string | undefined;
    services.sounds.installCurated = (manifest) => {
      installed = manifest.id;
      return install(manifest);
    };
    await user.click(await screen.findByRole('button', { name: 'Download' }));
    expect(installed).toBe('qxmLveBRBWt8');
  });
});
