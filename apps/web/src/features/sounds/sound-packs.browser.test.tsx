import { note, score } from '@reprise/model/testing';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { player } from '@/test/player-harness';

import { packContents, syntheticManifest, zipFileOf, zipOf } from './test/pack-fixtures';

/** A bass track on a GM program holding one whole note. */
const song = () =>
  score()
    .tempo(120)
    .track('bass', { name: 'Bass', program: 33 })
    .bar()
    .beat('1', [note(1, 3)])
    .build();

type Run = (p: ReturnType<typeof player>) => Promise<void>;

/** Opens the song, runs `before` (install, pick, remove), then renders two seconds of it. */
async function render(before: Run = () => Promise.resolve()) {
  const p = player();
  await p.openScore(song());
  p.services.ui.getState().toggleMixer();
  await before(p);
  await p.services.audio.settled();
  const offline = p.prepare(2);
  p.services.audio.unlock();
  p.services.audio.play();
  const buffer = await p.renderAudio(offline);
  // The memory event is coalesced to one per animation frame.
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const sounds = p.services.playback.getState().trackSounds;
  const residents = p.services.playback.getState().memory.residents;
  const error = {
    song: p.services.playback.getState().song.error,
    sounds: p.services.sounds.getState().problems,
  };
  const trackId = p.services.document.getState().score?.tracks[0]?.id ?? '';
  p.services.dispose();
  cleanup();
  return { data: buffer.getChannelData(0), sounds, residents, error, trackId };
}

const install: Run = async (p) => {
  const zip = zipFileOf('Pack.zip', await zipOf(packContents()));
  await p.services.sounds.installZip(zip, syntheticManifest());
};

const pick: Run = async (p) => {
  await install(p);
  const select = await screen.findByRole('combobox', { name: 'Sound of Bass' });
  fireEvent.change(select, { target: { value: 'SynthPack001/default' } });
  expect(p.services.document.getState().score?.tracks[0]?.sound).toEqual({
    packId: 'SynthPack001',
    instrument: 'default',
  });
};

const rms = (a: Float32Array, b: Float32Array) => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
  return Math.sqrt(sum / a.length);
};

describe('a sound pack, heard from the mixer', () => {
  it('plays the picked pack, then plays General MIDI again once the pack is removed', async () => {
    const gm = await render();
    const packed = await render(pick);
    const removed = await render(async (p) => {
      await pick(p);
      await p.services.audio.settled();
      expect(await p.services.sounds.remove('SynthPack001')).toBe(true);
    });

    expect(gm.sounds[gm.trackId]).toEqual({ tier: 'gm' });
    expect(packed.sounds[packed.trackId]).toEqual({ tier: 'hq', packId: 'SynthPack001' });
    expect(packed.residents.some((r) => r.startsWith('sfz:SynthPack001'))).toBe(true);
    expect(rms(gm.data, packed.data)).toBeGreaterThan(0.005);

    // The score still names the pack: the removal edits nothing, the track just plays GM.
    expect(removed.sounds[removed.trackId]).toEqual({
      tier: 'gm',
      packId: 'SynthPack001',
      problem: 'missing',
    });
    expect(rms(gm.data, removed.data)).toBeLessThan(1e-6);
    expect(removed.error.song).toBeUndefined();
    expect(removed.error.sounds).toEqual({});
  });
});
