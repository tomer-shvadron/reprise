import { syntheticSfzPack } from '@reprise/audio/testing';
import { applyCommand, newId, setTrackProperties, type Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createSoundPackStore } from '@/features/sounds';
import { fakePlatform } from '@/test/services';
import { fetchSyntheticSf2 } from '@/test/assets';
import { createPlaybackStore } from '@/state/playback';
import type { InstalledPackSource } from '@/state/sound-packs';

import { createAudioService } from './audio-service';

const MIB = 1024 * 1024;
const synthetic = fetchSyntheticSf2();
/** The memory event fires once per animation frame. */
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function setup() {
  const playback = createPlaybackStore();
  const sounds = createSoundPackStore({ platform: fakePlatform() });
  const audio = createAudioService({
    playback,
    packs: sounds,
    loadSoundfont: () => synthetic,
    createContext: () => {
      throw new Error('these tests never unlock');
    },
    defer: (run) => {
      run();
    },
  });
  return { playback, sounds, audio };
}

/** One guitar track naming `packId` (and `instrument`) in its sound. */
function song(sound?: { packId: string; instrument?: string }): { score: Score; track: string } {
  const plain = score()
    .tempo(120)
    .track('guitar', { program: 25 })
    .bar()
    .beat('4', [note(1, 3)]);
  const built = plain.build();
  const track = built.tracks[0]?.id ?? '';
  return {
    track,
    score: sound
      ? applyCommand(built, setTrackProperties({ trackId: track }, { sound })).score
      : built,
  };
}

function installed(
  id: string,
  options: { files?: InstalledPackSource['files']; entries?: Record<string, string> } = {},
): InstalledPackSource {
  return {
    id,
    name: 'Synthetic',
    files: options.files ?? syntheticSfzPack().files,
    instruments: [
      { key: 'one', name: 'One', entries: options.entries ?? { default: 'default.sfz' } },
      { key: 'two', name: 'Two', entries: { default: 'alt.sfz' } },
    ],
  };
}

describe('the audio service with sound packs', () => {
  it('mirrors every track as GM with no pack named', async () => {
    const { playback, audio } = setup();
    const { score: open, track } = song();
    audio.setDocument({ id: newId(), score: open });
    await audio.settled();
    expect(playback.getState().trackSounds).toEqual({ [track]: { tier: 'gm' } });
    expect(playback.getState().memory.budgetBytes).toBe(80 * MIB);
    audio.dispose();
  });

  it('marks a track whose pack is not installed as missing, and plays it GM', async () => {
    const { playback, audio } = setup();
    const packId = newId();
    const { score: open, track } = song({ packId });
    audio.setDocument({ id: newId(), score: open });
    await audio.settled();
    expect(playback.getState().trackSounds[track]).toEqual({
      tier: 'gm',
      packId,
      problem: 'missing',
    });
    expect(playback.getState().song.status).toBe('ready');
    audio.dispose();
  });

  it('is HQ for an installed pack and switches the budget to the HQ tier', async () => {
    const { playback, sounds, audio } = setup();
    const packId = newId();
    sounds.setInstalled([installed(packId)]);
    const { score: open, track } = song({ packId, instrument: 'two' });
    audio.setDocument({ id: newId(), score: open });
    await audio.settled();
    expect(playback.getState().trackSounds[track]).toEqual({ tier: 'hq', packId });
    await frame();
    expect(playback.getState().memory.budgetBytes).toBe(300 * MIB);
    audio.dispose();
  });

  it('treats an instrument the pack lacks as missing', async () => {
    const { playback, sounds, audio } = setup();
    const packId = newId();
    sounds.setInstalled([installed(packId)]);
    const { score: open, track } = song({ packId, instrument: 'three' });
    audio.setDocument({ id: newId(), score: open });
    await audio.settled();
    expect(playback.getState().trackSounds[track]?.problem).toBe('missing');
    audio.dispose();
  });

  it('reports a pack that fails to load as failed, with the engine message', async () => {
    const { playback, sounds, audio } = setup();
    const packId = newId();
    sounds.setInstalled([installed(packId, { entries: { default: 'nope.sfz' } })]);
    const { score: open, track } = song({ packId });
    audio.setDocument({ id: newId(), score: open });
    await audio.settled();
    const sound = playback.getState().trackSounds[track];
    expect(sound).toMatchObject({ tier: 'gm', packId, problem: 'failed' });
    expect(sound?.message).toContain('nope.sfz');
    audio.dispose();
  });

  it('reloads when the directory changes, and releasePack plays the pack GM until it is reinstalled', async () => {
    const { playback, sounds, audio } = setup();
    const packId = newId();
    const { score: open, track } = song({ packId });
    audio.setDocument({ id: newId(), score: open });
    await audio.settled();
    expect(playback.getState().trackSounds[track]?.problem).toBe('missing');

    const first = installed(packId);
    sounds.setInstalled([first]);
    await audio.settled();
    expect(playback.getState().trackSounds[track]?.tier).toBe('hq');

    await audio.releasePack(packId);
    expect(playback.getState().trackSounds[track]).toMatchObject({
      tier: 'gm',
      problem: 'missing',
    });
    await frame();
    expect(playback.getState().memory.budgetBytes).toBe(80 * MIB);

    // The same installed version stays out; a reinstall (new files) brings it back.
    sounds.setInstalled([first]);
    await audio.settled();
    expect(playback.getState().trackSounds[track]?.tier).toBe('gm');
    sounds.setInstalled([installed(packId)]);
    await audio.settled();
    expect(playback.getState().trackSounds[track]?.tier).toBe('hq');
    audio.dispose();
  });
});
