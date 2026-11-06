import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { render, screen, waitFor } from '@testing-library/react';
import { expect } from 'vitest';

import { App } from '@/app/app';
import { createAudioService } from '@/app/audio/audio-service';
import { createAppServices } from '@/app/services';
import { createUiStore } from '@/state/ui';

import { fetchFixture, fetchSyntheticSf2 } from './assets';
import { drive, manualTicker } from './offline';
import { fakePlatform, memoryStorage } from './services';

const SAMPLE_RATE = 44_100;
export const PLAYER_START = 0.1;

/** `<App>` over the real audio service on an OfflineAudioContext, driven by manual tickers. */
export function player(soundfont: () => Promise<Uint8Array> = fetchSyntheticSf2) {
  const next: { file: { name: string; bytes: Uint8Array } | undefined } = { file: undefined };
  const contexts: OfflineAudioContext[] = [];
  let context: OfflineAudioContext | undefined;
  const scheduler = manualTicker();
  const frames = manualTicker();
  // Each player its own storage, so one test's stored preferences never reach the next.
  const storage = memoryStorage();
  const services = createAppServices({
    storage: () => storage,
    platform: fakePlatform({ openFile: () => Promise.resolve(next.file) }),
    ui: createUiStore('light'),
    audio: (playback) =>
      createAudioService({
        playback,
        loadSoundfont: soundfont,
        createContext: () => {
          if (!context) throw new Error('the test has not made a context yet');
          contexts.push(context);
          return context;
        },
        scheduler: scheduler.ticker,
        frames: frames.ticker,
        startLatency: PLAYER_START,
        defer: (run) => {
          run();
        },
      }),
  });
  render(<App services={services} keyboard="mac" />);

  /** Opens a fixture, under `name` in place of its own file name when one is given. */
  async function open(path: string, name = path.split('/').pop() ?? path) {
    next.file = { name, bytes: await fetchFixture(path) };
    await services.document.getState().open();
    await painted();
  }

  async function painted() {
    await waitFor(() => {
      const region = screen.getByRole('region', { name: /^Score: / });
      expect(region).toHaveAttribute('aria-busy', 'false');
      expect(region.querySelector('[data-system-id]')).not.toBeNull();
    });
    await services.audio.settled();
  }

  /** Makes the context the next gesture or Play creates, `seconds` long. */
  function prepare(seconds: number): OfflineAudioContext {
    context = new OfflineAudioContext({
      numberOfChannels: 2,
      length: Math.round(seconds * SAMPLE_RATE),
      sampleRate: SAMPLE_RATE,
    });
    return context;
  }

  const renderAudio = (
    offline: OfflineAudioContext,
    actions: readonly { at: number; run: () => void }[] = [],
  ) => drive(offline, { tickers: [scheduler, frames], actions });

  async function openScore(song: Score) {
    await services.document
      .getState()
      .openBytes('song.reprise', (await write(song, 'reprise')).bytes);
    await painted();
  }

  return { services, open, openScore, painted, prepare, renderAudio, contexts, scheduler, frames };
}
