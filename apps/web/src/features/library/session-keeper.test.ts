import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TrackSession } from '@/features/tracks';
import { setTrackVisible } from '@/features/tracks/track-actions';
import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { startSessionKeeper } from './session-keeper';

const song = () => score().track('guitar').track('bass').build();

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const bytes = (await write(song(), 'reprise')).bytes;
  const open = async (songId?: string) => {
    await services.document.getState().openBytes('a.reprise', bytes, songId ? { songId } : {});
    return services.document.getState().score?.tracks.map((track) => track.id) ?? [];
  };
  return { services, open };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the session keeper', () => {
  it('writes the latest session once, 500 ms after the last change', async () => {
    const { services, open } = await setup();
    const [lead = '', bass = ''] = await open('song-a');
    const save = vi.fn(() => Promise.resolve());
    startSessionKeeper(services, 'song-a', save);
    setTrackVisible(services, bass, false);
    await vi.advanceTimersByTimeAsync(300);
    services.audio.setTrack(lead, { mute: true });
    await vi.advanceTimersByTimeAsync(400);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      'song-a',
      expect.objectContaining({ view: { tracks: [lead] }, mixer: { [lead]: { mute: true } } }),
    );
  });

  it('writes nothing until something changes, so a restore is not written back', async () => {
    const { services, open } = await setup();
    await open('song-a');
    const save = vi.fn(() => Promise.resolve());
    startSessionKeeper(services, 'song-a', save);
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes a pending session when the document switches, then stops', async () => {
    const { services, open } = await setup();
    const [, bass = ''] = await open('song-a');
    const save = vi.fn<(songId: string, session: TrackSession) => Promise<void>>(() =>
      Promise.resolve(),
    );
    startSessionKeeper(services, 'song-a', save);
    setTrackVisible(services, bass, false);
    await open('song-b');
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0]).toBe('song-a');
    // The new document's changes are not this keeper's.
    const lead2 = services.document.getState().score?.tracks[0]?.id ?? '';
    services.audio.setTrack(lead2, { solo: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('ignores a document that belongs to another song', async () => {
    const { services, open } = await setup();
    const [lead = ''] = await open('song-b');
    const save = vi.fn(() => Promise.resolve());
    startSessionKeeper(services, 'song-a', save);
    services.audio.setTrack(lead, { mute: true });
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).not.toHaveBeenCalled();
  });

  it('flushes on stop and survives a failing save', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { services, open } = await setup();
    const [lead = ''] = await open('song-a');
    const save = vi.fn(() => Promise.reject(new Error('disk full')));
    const keeper = startSessionKeeper(services, 'song-a', save);
    services.audio.setTrack(lead, { solo: true });
    await keeper.stop();
    expect(save).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    await keeper.stop();
    expect(save).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('flushes on pagehide and when the page becomes hidden, and stops listening after stop', async () => {
    const { services, open } = await setup();
    const [lead = ''] = await open('song-a');
    const save = vi.fn(() => Promise.resolve());
    const keeper = startSessionKeeper(services, 'song-a', save);
    services.audio.setTrack(lead, { mute: true });
    window.dispatchEvent(new Event('pagehide'));
    expect(save).toHaveBeenCalledTimes(1);

    services.audio.setTrack(lead, { solo: true });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);

    await keeper.stop();
    services.audio.setTrack(lead, { solo: false });
    window.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});
