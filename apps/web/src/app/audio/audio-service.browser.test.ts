import { channelPanToStereo, channelVolumeToGain } from '@reprise/audio';
import { debugAudioEngine } from '@reprise/audio/testing';
import {
  applyCommand,
  createHistory,
  createTrack,
  newId,
  PPQ,
  setNote,
  setTrackProperties,
  type Score,
} from '@reprise/model';
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
    const { engine } = audio.debug();
    const { sampler, source, transport } = debugAudioEngine(engine);
    if (!sampler || !source || !transport) {
      throw new Error('the audio service is not running');
    }
    return { sampler, source, engine, transport };
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

  it('keeps a stopped transport where it was through an edit', async () => {
    const song = quarters(2);
    const { playback, audio } = setup();
    const id = await open(audio, song);
    audio.unlock();

    const titled = { ...song, meta: { ...song.meta, title: 'Edited' } };
    audio.setDocument({ id, score: titled });
    await audio.settled();
    expect(playback.getState().transport).toBe('stopped');
    expect(playback.getState().position?.position.playbackTick ?? 0).toBe(0);

    audio.seek(2 * PPQ);
    const noted = applyCommand(
      titled,
      setNote({ beatId: beatOf(titled, 0, 0, 0).id }, { string: 1, fret: 5 }),
    ).score;
    audio.setDocument({ id, score: noted });
    await audio.settled();
    expect(playback.getState().transport).toBe('stopped');
    expect(playback.getState().position?.position.playbackTick).toBeCloseTo(2 * PPQ);
    audio.dispose();
  });

  it('keeps a paused transport paused at its tick through an edit', async () => {
    const song = quarters(4);
    const { playback, audio, render } = setup({ seconds: 1.4 });
    const id = await open(audio, song);
    audio.unlock();
    audio.play();
    let paused = 0;
    let state = '';
    let tick = 0;

    await render([
      {
        at: 1,
        run: () => {
          audio.pause();
          paused = playback.getState().position?.position.playbackTick ?? 0;
        },
      },
      {
        at: 1.1,
        run: () => {
          const edited = applyCommand(
            song,
            setNote({ beatId: beatOf(song, 0, 2, 0).id }, { string: 1, fret: 5 }),
          ).score;
          audio.setDocument({ id, score: edited });
          state = playback.getState().transport;
          tick = playback.getState().position?.position.playbackTick ?? 0;
        },
      },
    ]);

    expect(paused).toBeGreaterThan(0);
    expect(state).toBe('paused');
    expect(tick).toBeCloseTo(paused, 6);
    audio.dispose();
  });

  it('keeps a mute set while the sound bank loads', async () => {
    let arrive: (bytes: Uint8Array) => void = () => undefined;
    const late = new Promise<Uint8Array>((resolve) => {
      arrive = resolve;
    });
    const song = quarters(1);
    const trackId = song.tracks[0]?.id ?? '';
    const { playback, audio, debug } = setup({ loader: () => late });
    audio.unlock();
    audio.setDocument({ id: newId(), score: song });
    audio.setTrack(trackId, { mute: true });

    arrive(await synthetic);
    await audio.settled();

    expect(debug().sampler.strip(trackId)?.mute).toBe(true);
    expect(playback.getState().mixer).toEqual({ [trackId]: { mute: true } });
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

    expect(debugAudioEngine(audio.debug().engine).source?.memory().residents).toEqual([
      'gm:drums:0',
    ]);
    expect(playback.getState().song.status).toBe('ready');
    audio.dispose();
  });

  it('ignores a seek until the engine has the song, which waits on the sound bank', async () => {
    let arrive: (bytes: Uint8Array) => void = () => undefined;
    const late = new Promise<Uint8Array>((resolve) => {
      arrive = resolve;
    });
    const { playback, audio } = setup({ loader: () => late });
    audio.unlock();
    audio.setDocument({ id: newId(), score: quarters(2) });
    expect(() => {
      audio.seek(PPQ);
    }).not.toThrow();
    expect(playback.getState().position).toBeUndefined();
    expect(audio.outputLatency()).toBe(0);

    arrive(await synthetic);
    await audio.settled();
    audio.seek(PPQ);
    expect(playback.getState().position?.position.playbackTick).toBeCloseTo(PPQ);
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

  describe('a timeline-neutral edit', () => {
    const volume = (song: Score, value: number) =>
      setTrackProperties({ trackId: song.tracks[0]?.id ?? '' }, { channel: { volume: value } });

    it('reaches the strip at once with no rebuild, and its undo too', async () => {
      const song = quarters(4);
      const trackId = song.tracks[0]?.id ?? '';
      const { playback, audio, render, debug } = setup({ seconds: 1.6 });
      const id = await open(audio, song);
      audio.unlock();
      const { sampler, transport } = debug();
      const load = vi.spyOn(transport, 'load');
      audio.play();
      const history = createHistory();
      let gain = 0;
      let state = '';
      let tickBefore = 0;
      let tickAfter = 0;

      await render([
        {
          at: 1,
          run: () => {
            tickBefore = playback.getState().position?.position.playbackTick ?? 0;
            const edited = history.apply(song, volume(song, 40)).score;
            audio.setDocument({ id, score: edited });
            gain = sampler.strip(trackId)?.gain ?? 0;
            state = playback.getState().transport;
          },
        },
        {
          at: 1.1,
          run: () => {
            tickAfter = playback.getState().position?.position.playbackTick ?? 0;
          },
        },
      ]);

      expect(load).not.toHaveBeenCalled();
      expect(gain).toBeCloseTo(channelVolumeToGain(40));
      expect(state).toBe('playing');
      expect(tickAfter).toBeGreaterThan(tickBefore);
      audio.stop();
      expect(sampler.strip(trackId)?.gain).toBeCloseTo(channelVolumeToGain(40));

      const undone = history.undo()?.score;
      if (!undone) throw new Error('no undo');
      audio.setDocument({ id, score: undone });
      expect(load).not.toHaveBeenCalled();
      expect(sampler.strip(trackId)?.gain).toBeCloseTo(channelVolumeToGain(100));
      audio.dispose();
    });

    it('moves the pan with no rebuild', async () => {
      const song = quarters(1);
      const trackId = song.tracks[0]?.id ?? '';
      const { audio, debug } = setup();
      const id = await open(audio, song);
      audio.unlock();
      const { sampler, transport } = debug();
      const load = vi.spyOn(transport, 'load');
      const edited = applyCommand(
        song,
        setTrackProperties({ trackId }, { channel: { pan: 0 } }),
      ).score;
      audio.setDocument({ id, score: edited });
      expect(load).not.toHaveBeenCalled();
      expect(sampler.strip(trackId)?.pan).toBeCloseTo(channelPanToStereo(0));
      audio.dispose();
    });

    it('switches the instrument with no rebuild and counts its samples in', async () => {
      const song = quarters(1);
      const trackId = song.tracks[0]?.id ?? '';
      const { playback, audio, context, debug } = setup();
      const id = await open(audio, song);
      audio.unlock();
      const { sampler, transport } = debug();
      const load = vi.spyOn(transport, 'load');
      const loads: (number | undefined)[] = [];
      const unsubscribe = playback.subscribe((state) => {
        loads.push(state.instrumentLoads[trackId]?.loaded);
      });
      const edited = applyCommand(song, setTrackProperties({ trackId }, { program: 0 })).score;
      audio.setDocument({ id, score: edited });

      expect(load).not.toHaveBeenCalled();
      const bank = debugAudioEngine(audio.debug().engine).bank;
      const track = edited.tracks[0];
      if (!bank || !track) throw new Error('no bank');
      expect(sampler.instrumentAt(trackId, context.currentTime)).toBe(bank.instrument(track, 0));
      await audio.settled();
      unsubscribe();
      expect(loads[0]).toBe(0);
      expect(playback.getState().instrumentLoads).toEqual({});
      expect(playback.getState().instruments).toBe(1);
      await new Promise((resolve) => requestAnimationFrame(resolve));
      expect(playback.getState().memory.residents).toContain(bank.instrumentId(track, 0));
      audio.dispose();
    });

    it('previews a strip without an override, until a stop restores the score', async () => {
      const song = quarters(1);
      const trackId = song.tracks[0]?.id ?? '';
      const { playback, audio, debug } = setup();
      await open(audio, song);
      audio.unlock();
      const { sampler } = debug();
      audio.previewTrack(trackId, { volume: 30 });
      expect(sampler.strip(trackId)?.gain).toBeCloseTo(channelVolumeToGain(30));
      expect(playback.getState().mixer).toEqual({});
      audio.play();
      audio.stop();
      expect(sampler.strip(trackId)?.gain).toBeCloseTo(channelVolumeToGain(100));
      audio.dispose();
    });

    it('joins a rebuild already queued, which then applies it', async () => {
      const song = quarters(1);
      const trackId = song.tracks[0]?.id ?? '';
      const queued: (() => void)[] = [];
      const playback = createPlaybackStore();
      const context = new OfflineAudioContext({
        numberOfChannels: 2,
        length: SAMPLE_RATE,
        sampleRate: SAMPLE_RATE,
      });
      const audio = createAudioService({
        playback,
        loadSoundfont: () => synthetic,
        createContext: () => context,
        scheduler: manualTicker().ticker,
        frames: manualTicker().ticker,
        defer: (run) => {
          queued.push(run);
        },
      });
      const id = await open(audio, song);
      audio.unlock();
      const { sampler, transport } = debugAudioEngine(audio.debug().engine);
      if (!sampler || !transport) throw new Error('no engine');
      const load = vi.spyOn(transport, 'load');
      const noted = applyCommand(
        song,
        setNote({ beatId: beatOf(song, 0, 0, 0).id }, { string: 1, fret: 5 }),
      ).score;
      audio.setDocument({ id, score: noted });
      audio.setDocument({ id, score: applyCommand(noted, volume(noted, 40)).score });
      expect(load).not.toHaveBeenCalled();
      for (const run of queued.splice(0)) run();
      expect(load).toHaveBeenCalledOnce();
      expect(sampler.strip(trackId)?.gain).toBeCloseTo(channelVolumeToGain(40));
      audio.dispose();
    });

    it('clears instrument loads on a switch', async () => {
      const { playback, audio } = setup();
      await open(audio, quarters(1));
      playback.setState({ instrumentLoads: { x: { loaded: 1, total: 2 } } });
      await open(audio, quarters(1));
      expect(playback.getState().instrumentLoads).toEqual({});
      audio.dispose();
    });
  });
});
