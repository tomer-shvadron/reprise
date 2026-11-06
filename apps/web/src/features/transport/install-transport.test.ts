import { write } from '@reprise/formats';
import { removeBar } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { fourBars } from '@/test/position';
import { createTestServices, memoryStorage } from '@/test/services';

import { TRANSPORT_STORAGE_KEY } from './preferences';
import { mirrorAudio } from './test/mirror-audio';

const bytes = async () => (await write(fourBars(), 'reprise')).bytes;

describe('installTransport', () => {
  it('applies the stored preferences and writes changes back', () => {
    const storage = memoryStorage();
    storage.setItem(
      TRANSPORT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        countIn: true,
        metronome: { on: true, volume: 0.4 },
        masterVolume: 0.5,
      }),
    );
    const services = createTestServices({ storage: () => storage });
    expect(services.fakeAudio.setCountIn).toHaveBeenCalledWith(true);
    expect(services.fakeAudio.setMetronome).toHaveBeenCalledWith(true, 0.4);
    expect(services.fakeAudio.setMasterVolume).toHaveBeenCalledWith(0.5);

    mirrorAudio(services);
    services.audio.setCountIn(true);
    services.audio.setCountIn(false);
    expect(JSON.parse(storage.getItem(TRANSPORT_STORAGE_KEY) ?? '{}')).toMatchObject({
      countIn: false,
    });

    // A reload: a second app over the same storage starts with the count-in off.
    const reloaded = createTestServices({ storage: () => storage });
    expect(reloaded.fakeAudio.setCountIn).toHaveBeenCalledWith(false);
  });

  it('resets the speed for a different song and keeps it for the same file reopened', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    const { document, audio, playback } = services;
    await document.getState().openBytes('a.reprise', await bytes());
    audio.setTempo('percent', 75);
    await document.getState().openBytes('b.reprise', await bytes());
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 100 });
    await document.getState().openBytes('a.reprise', await bytes());
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 75 });
  });

  it('retargets an active loop to a new selection and keeps it when the selection clears', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    await services.document.getState().openBytes('a.reprise', await bytes());
    const bars = services.document.getState().score?.masterBars ?? [];
    const whole = { startBar: bars[0]?.id ?? '', endBar: bars[3]?.id ?? '' };
    const middle = { startBar: bars[1]?.id ?? '', endBar: bars[2]?.id ?? '' };

    services.selection.getState().selectBars(middle);
    expect(services.playback.getState().settings.loop).toBeUndefined();
    services.audio.setLoop(whole);
    services.selection.getState().selectBars(undefined);
    services.selection.getState().selectBars(middle);
    expect(services.playback.getState().settings.loop).toEqual(middle);
    services.selection.getState().selectBars(undefined);
    expect(services.playback.getState().settings.loop).toEqual(middle);
  });

  it('turns the loop off when an edit deletes one of its bars', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    await services.document.getState().openBytes('a.reprise', await bytes());
    const bars = services.document.getState().score?.masterBars ?? [];
    services.audio.setLoop({ startBar: bars[1]?.id ?? '', endBar: bars[3]?.id ?? '' });
    services.document.getState().apply(removeBar({ masterBarId: bars[3]?.id ?? '' }));
    expect(services.playback.getState().settings.loop).toBeUndefined();
  });
});
