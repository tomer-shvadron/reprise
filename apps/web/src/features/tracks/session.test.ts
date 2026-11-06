import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { mirrorAudio } from '@/test/mirror-audio';
import { createTestServices } from '@/test/services';

import { captureTrackSession, restoreTrackSession, watchTrackSession } from './session';
import { selectTrack, setTrackNotation, setTrackVisible, toggleMultitrack } from './track-actions';

const song = () => score().track('guitar').track('bass').track('drums').build();

async function setup() {
  const services = createTestServices();
  mirrorAudio(services);
  const bytes = (await write(song(), 'reprise')).bytes;
  const open = async () => {
    await services.document.getState().openBytes('song.reprise', bytes);
    return services.document.getState().score?.tracks.map((track) => track.id) ?? [];
  };
  return { services, open };
}

describe('the track session', () => {
  it('is undefined with no document', async () => {
    const { services } = await setup();
    expect(captureTrackSession(services)).toBeUndefined();
  });

  it('round-trips the view, the mixer overrides and the current track in one layout', async () => {
    const { services, open } = await setup();
    const [lead = '', bass = '', drums = ''] = await open();
    setTrackVisible(services, drums, false);
    setTrackNotation(services, bass, 'standard');
    selectTrack(services, bass);
    toggleMultitrack(services);
    services.audio.setTrack(drums, { solo: true });
    const session = captureTrackSession(services);
    expect(session).toEqual({
      version: 1,
      view: { tracks: [lead, bass], notation: { [bass]: 'standard' }, only: bass },
      mixer: { [drums]: { solo: true } },
      currentTrack: bass,
    });
    if (!session) throw new Error('no session');

    await open();
    expect(services.document.getState().view).toEqual({ tracks: 'all', notation: {} });
    const layouts = vi.fn();
    const unsubscribe = services.layout.subscribe(layouts);
    restoreTrackSession(services, session);
    unsubscribe();

    expect(layouts).toHaveBeenCalledOnce();
    expect(services.document.getState().view).toEqual(session.view);
    expect(services.playback.getState().mixer).toEqual({ [drums]: { solo: true } });
    expect(services.selection.getState().currentTrack).toBe(bass);
  });

  it('drops ids the score no longer has', async () => {
    const { services, open } = await setup();
    const [lead = ''] = await open();
    restoreTrackSession(services, {
      version: 1,
      view: { tracks: ['gone'], notation: { gone: 'both', [lead]: 'both' }, only: 'gone' },
      mixer: { gone: { mute: true } },
      currentTrack: 'gone',
    });
    expect(services.document.getState().view).toEqual({
      tracks: 'all',
      notation: { [lead]: 'both' },
    });
    expect(services.fakeAudio.setTrack).not.toHaveBeenCalled();
    expect(services.selection.getState().currentTrack).toBe(lead);
  });

  it('is watched on a view, mixer or current-track change, never on a switch', async () => {
    const { services, open } = await setup();
    const [lead = '', bass = ''] = await open();
    const listener = vi.fn();
    const stop = watchTrackSession(services, listener);

    setTrackNotation(services, lead, 'both');
    services.audio.setTrack(lead, { mute: true });
    selectTrack(services, bass);
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTrack: bass }),
      services.document.getState().id,
    );

    await open();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
  });
});
