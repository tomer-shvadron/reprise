import { write } from '@reprise/formats';
import { removeBar } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { fourBars } from '@/test/position';
import { createTestServices, fakePlatform, memoryStorage } from '@/test/services';

import { TRANSPORT_STORAGE_KEY } from './preferences';
import { mirrorAudio } from './test/mirror-audio';

// Each call builds the song afresh with new ids, so each returns different bytes.
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

  it('keys the speed by the bytes, so a same-named different song starts at 100%', async () => {
    const services = createTestServices();
    mirrorAudio(services);
    const { document, audio, playback } = services;
    const first = await bytes();
    await document.getState().openBytes('a.reprise', first);
    audio.setTempo('percent', 75);
    await document.getState().openBytes('a.reprise', await bytes());
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 100 });
    // The first song's bytes under a new name are still that song.
    await document.getState().openBytes('renamed.reprise', first);
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 75 });
  });

  it('keeps the speed across a save, for the saved file reopened', async () => {
    const written: Uint8Array[] = [];
    const services = createTestServices({
      platform: fakePlatform({
        writeHandle: (_handle, data) => {
          written.push(data);
          return Promise.resolve();
        },
      }),
    });
    mirrorAudio(services);
    const { document, audio, playback } = services;
    const first = await bytes();
    await document.getState().openBytes('a.reprise', first, '/music/a.reprise');
    audio.setTempo('percent', 75);
    const bars = document.getState().score?.masterBars ?? [];
    document.getState().apply(removeBar({ masterBarId: bars[3]?.id ?? '' }));
    await document.getState().save();
    const saved = written[0];
    if (!saved) throw new Error('nothing was saved');
    expect(saved).not.toEqual(first);

    await document.getState().openBytes('b.reprise', await bytes());
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 100 });
    await document.getState().openBytes('a.reprise', saved);
    expect(playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 75 });
  });

  it('announces each sound load stage once, not its progress', () => {
    const services = createTestServices();
    const { playback, transport } = services;
    const spoken: string[] = [];
    transport.subscribe(({ announcement }, previous) => {
      if (announcement && announcement !== previous.announcement) spoken.push(announcement.text);
    });
    const sounds = (loaded: number) => {
      playback.setState({ sounds: { status: 'loading', loaded, total: 100, error: undefined } });
    };
    sounds(1);
    sounds(2);
    sounds(50);
    playback.setState({
      sounds: { status: 'error', loaded: 50, total: 100, error: 'missing' },
    });
    expect(spoken).toEqual(['Loading sounds…', 'Sounds unavailable']);
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
