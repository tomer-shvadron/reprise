import { waitFor } from '@testing-library/react';
import { createTimeline, type PlaybackState } from '@reprise/audio';
import { debugAudioEngine } from '@reprise/audio/testing';
import { secondsAtTick, type Id } from '@reprise/model';
import { describe, expect, it } from 'vitest';

import { fetchFixture, fetchGeneralUser, fixturePaths } from '@/test/assets';
import { rms } from '@/test/offline';
import { player, PLAYER_START } from '@/test/player-harness';

const START = PLAYER_START;
const generalUser = await fetchGeneralUser();

/** Plays bar 1 of the open score and reports what was heard and seen. */
async function playBarOne(p: ReturnType<typeof player>) {
  const score = p.services.document.getState().score;
  if (!score) throw new Error('no score open');
  const timeline = createTimeline(score);
  const barEnd = secondsAtTick(timeline.map, timeline.map.passes[1]?.startTick ?? timeline.endTick);
  const offline = p.prepare(START + barEnd + 0.5);
  const states = new Set<PlaybackState>();
  const bars = new Set<Id>();
  const unsubscribe = p.services.playback.subscribe((state) => {
    states.add(state.transport);
    if (state.position) bars.add(state.position.masterBarId);
  });
  p.services.audio.play();
  const buffer = await p.renderAudio(offline);
  unsubscribe();
  const samples = [0, 1].flatMap((channel) => [...buffer.getChannelData(channel)]);
  return {
    score,
    buffer,
    barEnd,
    states,
    bars,
    finite: samples.every(Number.isFinite),
    peak: samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0),
    misses: debugAudioEngine(p.services.audio.debug().engine).sampler?.misses,
  };
}

describe('the player', () => {
  it('opens a gp5 file, paints it and plays its first bar', async () => {
    const p = player();
    await p.open('gp5/chords.gp5');

    const heard = await playBarOne(p);

    expect(heard.states.has('playing')).toBe(true);
    expect(heard.bars.has(heard.score.masterBars[0]?.id ?? '')).toBe(true);
    expect(heard.finite).toBe(true);
    expect(heard.peak).toBeLessThanOrEqual(1);
    expect(rms(heard.buffer, START, START + heard.barEnd)).toBeGreaterThan(1e-4);
    expect(heard.misses).toBe(0);
    p.services.dispose();
  });

  it('opens, paints and loads every fixture, with no audio context', async () => {
    const p = player();
    const paths = await fixturePaths();
    expect(paths.length).toBeGreaterThanOrEqual(27);
    for (const path of paths) {
      await p.open(path);
      expect(p.services.layout.getState().result?.systems.length, path).toBeGreaterThanOrEqual(1);
      expect(p.services.playback.getState().song.status, path).toBe('ready');
    }
    expect(p.contexts).toHaveLength(0);
    p.services.dispose();
  }, 60_000);

  it('replaces the open file with a dropped one and evicts its instruments', async () => {
    const p = player();
    await p.open('gp5/chords.gp5');
    const first = p.services.document.getState().id;
    const firstLayout = p.services.layout.getState().result;
    const firstResidents = p.services.playback.getState().memory.residents;
    const firstSource = debugAudioEngine(p.services.audio.debug().engine).source;
    const bytes = await fetchFixture('gp5/percussion-all.gp5');

    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes.slice()], 'percussion-all.gp5'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, cancelable: true }));
    await waitFor(() => {
      expect(p.services.document.getState().id).not.toBe(first);
    });
    await p.painted();

    expect(p.services.layout.getState().result).not.toBe(firstLayout);
    const source = debugAudioEngine(p.services.audio.debug().engine).source;
    expect(source).toBe(firstSource);
    const residents = source?.memory().residents ?? [];
    expect(residents.some((id) => firstResidents.includes(id) && !id.includes('drums'))).toBe(
      false,
    );
    expect(source?.counters.evictions).toBeGreaterThanOrEqual(1);
    p.services.dispose();
  });

  it.skipIf(!generalUser)(
    'plays bar 1 of effects.gp5 through GeneralUser GS',
    async () => {
      const bytes = generalUser;
      if (!bytes) return;
      const p = player(() => Promise.resolve(bytes));
      await p.open('gp5/effects.gp5');

      const heard = await playBarOne(p);

      expect(heard.misses).toBe(0);
      expect(heard.finite).toBe(true);
      expect(rms(heard.buffer, START, START + heard.barEnd)).toBeGreaterThan(1e-3);
      p.services.dispose();
    },
    60_000,
  );
});
