import { write } from '@reprise/formats';
import { describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { fourBars } from '@/test/position';
import { createTestServices } from '@/test/services';

import { resumePractice } from './resume';

const SONG = 'SONGSONGSONG';

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const song = fourBars();
  const { bytes } = await write(song, 'reprise');
  const open = vi.fn(async () => {
    await services.document.getState().openBytes('song.reprise', bytes, { songId: SONG });
  });
  await open();
  const ids = services.document.getState().score?.masterBars.map((bar) => bar.id) ?? [];
  const { setTempo, setLoop, seek } = services.fakeAudio;
  // Close it again so the first test starts from a closed song.
  services.document.getState().close();
  open.mockClear();
  for (const fn of [setTempo, setLoop, seek]) fn.mockClear();
  return { services, open, ids };
}

const announced = (services: Awaited<ReturnType<typeof setup>>['services']) =>
  services.transport.getState().announcement?.text ?? '';

describe('resumePractice', () => {
  it('opens the song first, then sets the loop and tempo and shows the player', async () => {
    const { services, open, ids } = await setup();
    services.ui.getState().setScreen('library');
    await resumePractice(
      services,
      SONG,
      {
        loop: { startBar: ids[1] ?? '', endBar: ids[2] ?? '' },
        tempo: { mode: 'percent', value: 85 },
      },
      open,
    );
    expect(open).toHaveBeenCalledOnce();
    expect(services.playback.getState().settings.loop).toEqual({
      startBar: ids[1],
      endBar: ids[2],
    });
    expect(services.playback.getState().settings.tempo).toEqual({ mode: 'percent', value: 85 });
    // The song has not loaded in this test, and seeking before the load does nothing.
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.ui.getState().screen).toBe('player');
    expect(announced(services)).toContain('bars 2 to 3');
  });

  it('seeks to the loop’s start once the song is loaded', async () => {
    const { services, open, ids } = await setup();
    await open();
    services.playback.setState({ song: { status: 'ready', error: undefined } });
    await resumePractice(
      services,
      SONG,
      { loop: { startBar: ids[1] ?? '', endBar: ids[2] ?? '' }, tempo: undefined },
      open,
    );
    expect(services.fakeAudio.seek).toHaveBeenCalledOnce();
  });

  it('does not open a song that is already open', async () => {
    const { services, open, ids } = await setup();
    await open();
    open.mockClear();
    await resumePractice(
      services,
      SONG,
      { loop: { startBar: ids[0] ?? '', endBar: ids[0] ?? '' }, tempo: undefined },
      open,
    );
    expect(open).not.toHaveBeenCalled();
    expect(services.fakeAudio.setLoop).toHaveBeenCalledOnce();
  });

  it('does nothing when the open did not land', async () => {
    const { services, ids } = await setup();
    const failed = vi.fn(() => Promise.resolve());
    await resumePractice(
      services,
      SONG,
      {
        loop: { startBar: ids[0] ?? '', endBar: ids[0] ?? '' },
        tempo: { mode: 'percent', value: 50 },
      },
      failed,
    );
    expect(services.fakeAudio.setLoop).not.toHaveBeenCalled();
    expect(services.fakeAudio.setTempo).not.toHaveBeenCalled();
  });

  it('restores the tempo only, and says so, when the loop’s bars are gone', async () => {
    const { services, open } = await setup();
    await resumePractice(
      services,
      SONG,
      {
        loop: { startBar: 'GONEGONEGONE', endBar: 'GONEGONEGONE' },
        tempo: { mode: 'percent', value: 70 },
      },
      open,
    );
    expect(services.fakeAudio.setLoop).not.toHaveBeenCalled();
    expect(services.playback.getState().settings.tempo.value).toBe(70);
    expect(announced(services)).toContain('bars are gone');
  });

  it('keeps the previous loop when the engine cannot loop the range', async () => {
    const { services, open, ids } = await setup();
    await open();
    services.fakeAudio.setLoop({ startBar: ids[0] ?? '', endBar: ids[0] ?? '' });
    services.fakeAudio.setLoop.mockClear();
    services.fakeAudio.setLoop.mockImplementationOnce(() => {
      throw new RangeError('never in that order');
    });
    await resumePractice(
      services,
      SONG,
      {
        loop: { startBar: ids[1] ?? '', endBar: ids[2] ?? '' },
        tempo: { mode: 'percent', value: 60 },
      },
      open,
    );
    expect(services.fakeAudio.setLoop).toHaveBeenLastCalledWith({
      startBar: ids[0],
      endBar: ids[0],
    });
    expect(services.fakeAudio.seek).not.toHaveBeenCalled();
    expect(services.playback.getState().settings.tempo.value).toBe(60);
    expect(announced(services)).toContain('only the tempo');
  });
});
