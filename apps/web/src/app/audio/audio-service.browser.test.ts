import { channelVolumeToGain } from '@reprise/audio';
import { applyCommand, createTrack, newId, PPQ, setNote, type Score } from '@reprise/model';
import { beatOf, note, score, type BeatSpec } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createPlaybackStore } from '@/state/playback';
import { fetchSyntheticSf2 } from '@/test/assets';
import { drive, manualTicker, onset, rms } from '@/test/offline';

import { createAudioService, type AudioService } from './audio-service';
import { fetchSoundfont } from './soundfont-loader';

const SAMPLE_RATE = 44_100;
const START = 0.1;
/** The master bus limiter's lookahead, which every note and click carries. */
const BUS_DELAY = 264 / SAMPLE_RATE;

const synthetic = fetchSyntheticSf2();

function setup(options: { seconds?: number; loader?: () => Promise<Uint8Array> } = {}) {
  const playback = createPlaybackStore();
  const scheduler = manualTicker();
  const frames = manualTicker();
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round((options.seconds ?? 1) * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const createContext = vi.fn(() => context);
  const audio = createAudioService({
    playback,
    loadSoundfont: options.loader ?? (() => synthetic),
    createContext,
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: START,
    defer: (run) => {
      run();
    },
  });
  const render = (actions: { at: number; run: () => void }[] = []) =>
    drive(context, { tickers: [scheduler, frames], actions });
  const debug = () => {
    const { sampler, source, engine } = audio.debug();
    if (!sampler || !source || !engine) throw new Error('the audio service is not running');
    return { sampler, source, engine };
  };
  return { playback, audio, context, createContext, render, debug };
}

function quarters(
  bars: number,
  options: { beat?: (bar: number, beat: number) => BeatSpec; volume?: number } = {},
): Score {
  const { channel } = createTrack('fretted');
  let builder = score()
    .tempo(120)
    .track('guitar', {
      program: 25,
      channel: { ...channel, volume: options.volume ?? channel.volume },
    });
  for (let bar = 0; bar < bars; bar++) {
    builder = builder.bar();
    for (let beat = 0; beat < 4; beat++) {
      builder = builder.beat('4', [note(1, 3)], options.beat?.(bar, beat) ?? {});
    }
  }
  return builder.build();
}

async function open(audio: AudioService, song: Score, id: string = newId()) {
  audio.setDocument({ id, score: song });
  await audio.settled();
  return id;
}

describe('the audio service', () => {
  it('loads a song before any gesture and makes one context however often it unlocks', async () => {
    const { playback, audio, createContext } = setup();

    await open(audio, quarters(1));

    expect(createContext).not.toHaveBeenCalled();
    expect(playback.getState().song.status).toBe('ready');
    expect(playback.getState().sounds.status).toBe('ready');
    expect(playback.getState().output.status).toBe('locked');
    expect(playback.getState().instruments).toBe(1);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(playback.getState().memory.residents).toContain('gm:0:25');

    audio.unlock();
    audio.unlock();
    await open(audio, quarters(2));
    expect(createContext).toHaveBeenCalledOnce();
    expect(playback.getState().output.status).toBe('ready');
    audio.dispose();
  });

  it('routes the metronome through the master bus', async () => {
    const rests = score().tempo(120).track('guitar').bar().rest('1').build();
    const { audio, render } = setup({ seconds: 0.6 });
    audio.setMetronome(true, 1);
    await open(audio, rests);
    audio.unlock();
    audio.play();

    const buffer = await render();

    const first = onset(buffer, 1e-3);
    expect(first).toBeDefined();
    expect(Math.abs((first ?? 0) - (START + BUS_DELAY))).toBeLessThan(0.0005);
    audio.dispose();
  });

  it('keeps playing through an edit, from the same tick', async () => {
    const song = quarters(4);
    const { playback, audio, render } = setup({ seconds: 1.6 });
    const id = await open(audio, song);
    audio.unlock();
    audio.play();
    let before = 0;
    let after = 0;
    let stateAfter = '';
    const edited = applyCommand(
      song,
      setNote({ beatId: beatOf(song, 0, 2, 0).id }, { string: 1, fret: 5 }),
    ).score;

    const buffer = await render([
      {
        at: 1,
        run: () => {
          before = playback.getState().position?.position.playbackTick ?? 0;
          audio.setDocument({ id, score: edited });
          stateAfter = playback.getState().transport;
        },
      },
      {
        at: 1.05,
        run: () => {
          after = playback.getState().position?.position.playbackTick ?? 0;
        },
      },
    ]);

    expect(before).toBeGreaterThan(0);
    expect(stateAfter).toBe('playing');
    expect(after).toBeGreaterThanOrEqual(before);
    // The synthetic bank is quiet, so the edit is measured against the bars before it.
    expect(rms(buffer, 1.1, 1.5)).toBeGreaterThan(0.5 * rms(buffer, 0.3, 0.9));
    expect(rms(buffer, 1.1, 1.5)).toBeGreaterThan(1e-4);
    audio.dispose();
  });

  it('leaves a stopped transport stopped at tick 0 after an edit', async () => {
    const song = quarters(2);
    const { playback, audio } = setup();
    const id = await open(audio, song);
    audio.unlock();

    audio.setDocument({ id, score: { ...song, meta: { ...song.meta, title: 'Edited' } } });
    await audio.settled();

    expect(playback.getState().transport).toBe('stopped');
    expect(playback.getState().position?.position.playbackTick ?? 0).toBe(0);
    audio.dispose();
  });

  describe('the channel baseline', () => {
    // Bar 2 opens with a mixer change: volume 20 and program 1, which the run must not keep.
    const mixed = () =>
      quarters(3, {
        volume: 100,
        beat: (bar, beat) =>
          bar === 1 && beat === 0 ? { mix: { volume: { value: 20 }, program: 1 } } : {},
      });

    it('is restored on stop, with a user override kept', async () => {
      const song = mixed();
      const trackId = song.tracks[0]?.id ?? '';
      const { audio, render, debug, context } = setup({ seconds: 2.8 });
      await open(audio, song);
      audio.unlock();
      const { sampler } = debug();
      const base = sampler.instrumentAt(trackId, 0).regions;
      audio.setTrack(trackId, { mute: true });
      audio.play();
      let during = 0;

      await render([
        {
          at: 2.4,
          run: () => {
            during = sampler.strip(trackId)?.gain ?? 0;
          },
        },
        {
          at: 2.5,
          run: () => {
            audio.stop();
          },
        },
      ]);

      expect(during).toBeCloseTo(channelVolumeToGain(20));
      expect(sampler.strip(trackId)?.gain).toBeCloseTo(channelVolumeToGain(100));
      expect(sampler.instrumentAt(trackId, context.currentTime).regions).toBe(base);
      expect(sampler.strip(trackId)?.mute).toBe(true);
      audio.dispose();
    });

    it('is restored when a running transport seeks', async () => {
      const song = mixed();
      const trackId = song.tracks[0]?.id ?? '';
      const { audio, render, debug } = setup({ seconds: 2.8 });
      await open(audio, song);
      audio.unlock();
      const { sampler } = debug();
      audio.play();
      let afterSeek = 0;

      await render([
        {
          at: 2.5,
          run: () => {
            audio.seek(0);
            afterSeek = sampler.strip(trackId)?.gain ?? 0;
          },
        },
      ]);

      expect(afterSeek).toBeCloseTo(channelVolumeToGain(100));
      audio.dispose();
    });

    it('is restored when a seek lands during a count-in', async () => {
      const song = mixed();
      const trackId = song.tracks[0]?.id ?? '';
      const { playback, audio, render, debug } = setup({ seconds: 2.9 });
      await open(audio, song);
      audio.unlock();
      const { sampler } = debug();
      // From bar 3, so the count-in's last beat already carries bar 2's volume 20.
      audio.seek(2 * 4 * PPQ);
      audio.setCountIn(true);
      audio.play();
      let state: string | undefined;
      let inBarOne = 0;

      await render([
        {
          at: 2,
          run: () => {
            state = playback.getState().transport;
            audio.seek(0);
          },
        },
        {
          at: 2.8,
          run: () => {
            inBarOne = sampler.strip(trackId)?.gain ?? 0;
          },
        },
      ]);

      expect(state).toBe('counting-in');
      expect(inBarOne).toBeCloseTo(channelVolumeToGain(100));
      audio.dispose();
    });

    it('replays the loop start’s mixer change at each wrap', async () => {
      const song = mixed();
      const trackId = song.tracks[0]?.id ?? '';
      const [, second, third] = song.masterBars;
      if (!second || !third) throw new Error('three bars expected');
      const { playback, audio, render, debug } = setup({ seconds: 4.6 });
      await open(audio, song);
      audio.unlock();
      const { sampler } = debug();
      audio.setLoop({ startBar: second.id, endBar: third.id });
      audio.play();
      let afterWrap: number | undefined;

      await render([
        {
          at: 4.5,
          run: () => {
            afterWrap = sampler.strip(trackId)?.gain;
          },
        },
      ]);

      expect(playback.getState().lastLoop?.pass).toBeGreaterThanOrEqual(1);
      expect(afterWrap).toBeCloseTo(channelVolumeToGain(20));
      audio.dispose();
    });
  });

  it('evicts the first song’s instruments when a second replaces it', async () => {
    const guitarSong = quarters(1);
    const drumSong = score()
      .tempo(120)
      .track('drums')
      .bar()
      .beat('4', [note(0, 36)])
      .beat('4', [note(0, 38)])
      .build();
    const { playback, audio, debug } = setup();
    await open(audio, guitarSong);
    audio.unlock();
    audio.setTrack(guitarSong.tracks[0]?.id ?? '', { volume: 50 });
    expect(Object.keys(playback.getState().mixer)).toHaveLength(1);

    await open(audio, drumSong);

    const { source } = debug();
    expect(source.memory().residents).toEqual(['gm:drums:0']);
    expect(source.counters.evictions).toBeGreaterThanOrEqual(1);
    expect(playback.getState().mixer).toEqual({});
    audio.dispose();
  });

  it('reports a missing sound bank and recovers on retry', async () => {
    const bytes = await synthetic;
    let calls = 0;
    const fakeFetch = vi.fn(() => {
      calls += 1;
      const body = calls === 1 ? new TextEncoder().encode('<!doctype html>') : bytes;
      return Promise.resolve(new Response(body.slice(), { status: 200 }));
    });
    const { playback, audio } = setup({
      loader: () => fetchSoundfont('/sounds/gm/GeneralUser-GS.sf2', () => undefined, fakeFetch),
    });

    await open(audio, quarters(1));

    expect(playback.getState().sounds).toMatchObject({ status: 'error' });
    expect(playback.getState().sounds.error).toMatch(/sound bank is missing/);
    expect(playback.getState().song.status).toBe('error');

    audio.retry();
    await audio.settled();

    expect(playback.getState().sounds.status).toBe('ready');
    expect(playback.getState().song.status).toBe('ready');
    audio.dispose();
  });

  it('abandons a load a newer document replaced', async () => {
    const guitarSong = quarters(1);
    const drumSong = score()
      .tempo(120)
      .track('drums')
      .bar()
      .beat('4', [note(0, 36)])
      .build();
    const { playback, audio } = setup();

    audio.setDocument({ id: newId(), score: guitarSong });
    audio.setDocument({ id: newId(), score: drumSong });
    await audio.settled();

    expect(audio.debug().source?.memory().residents).toEqual(['gm:drums:0']);
    expect(playback.getState().song.status).toBe('ready');
    audio.dispose();
  });

  it('sets the master volume before and after the engine exists', async () => {
    const { playback, audio, render, debug } = setup({ seconds: 2.2 });
    audio.setMasterVolume(0.5);
    expect(playback.getState().settings.masterVolume).toBe(0.5);
    expect(() => {
      audio.setMasterVolume(1.5);
    }).toThrow(RangeError);
    await open(audio, quarters(1));
    audio.unlock();
    expect(debug().sampler.master.gain).toBe(0.5);

    audio.setMasterVolume(0);
    audio.play();
    const buffer = await render();
    expect(rms(buffer, START + 0.1, 2.1)).toBeLessThan(1e-6);
  });
});
