import { applyCommand, createTrack, setNote, setTrackProperties } from '@reprise/model';
import type { Score } from '@reprise/model';
import { beatOf, note, score } from '@reprise/model/testing';
import type { BeatSpec } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createAudioEngine, debugAudioEngine } from './engine';
import type {
  AudioEngine,
  InstrumentLoads,
  LoadOptions,
  PlaybackState,
  PositionEvent,
} from './engine';
import { drive, manualTicker } from './offline-driver';
import { channelVolumeToGain } from './sampler/sampler';
import { GM_BUDGET_BYTES } from './samples/managed-sample-source';
import { Sf2Soundfont } from './sf2/soundfont';
import { loadGeneralUser } from './test/harness';
import { rms as signalRms, signalOf } from './test/signal';

const SAMPLE_RATE = 44_100;
const START = 0.1;
const GM: LoadOptions = { tier: 'gm', packs: [] };
const SYNTHETIC = new URL('../test-fixtures/synthetic.sf2', import.meta.url);

let syntheticFont: Promise<Sf2Soundfont> | undefined;
function synthetic(): Promise<Sf2Soundfont> {
  syntheticFont ??= fetch(SYNTHETIC)
    .then((response) => response.arrayBuffer())
    .then((bytes) => Sf2Soundfont.parse(new Uint8Array(bytes)));
  return syntheticFont;
}

const generalUser = await loadGeneralUser();

const rms = (buffer: AudioBuffer, from: number, to: number) =>
  signalRms(signalOf(buffer), from, to);

/** Quarters on string 1, fret 3, program 25, at 120 BPM: quarter `k` sounds at `START + k / 2`. */
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

const trackOf = (song: Score) => song.tracks[0]?.id ?? '';

async function setup(options: { seconds?: number; lazy?: boolean; font?: Sf2Soundfont } = {}) {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round((options.seconds ?? 1) * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const factory = vi.fn(() => context);
  const scheduler = manualTicker();
  const frames = manualTicker();
  const engine = createAudioEngine({
    context: options.lazy ? factory : context,
    scheduleMemory: (run) => {
      run();
    },
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: START,
  });
  engine.setSoundfont(options.font ?? (await synthetic()));
  const states: PlaybackState[] = [];
  const positions: PositionEvent[] = [];
  engine.on('state', (state) => states.push(state));
  engine.on('position', (position) => positions.push(position));
  const render = (actions: { at: number; run: () => void }[] = []) =>
    drive(context, { tickers: [scheduler, frames], actions });
  const live = () => {
    const { sampler, transport, source, bank } = debugAudioEngine(engine);
    if (!sampler || !transport || !source || !bank) throw new Error('the engine is not live');
    return { sampler, transport, source, bank };
  };
  return { context, factory, engine, states, positions, render, live };
}

const tickOf = (positions: readonly PositionEvent[]) => positions.at(-1)?.position.playbackTick;

describe('createAudioEngine', () => {
  it('makes its context lazily, on the first play, and only once', async () => {
    const { engine, factory } = await setup({ lazy: true });
    await expect(engine.load(quarters(1), GM)).resolves.toEqual({ instruments: ['gm:0:25'] });
    expect(engine.memory().decodedBytes).toBeGreaterThan(0);
    expect(factory).not.toHaveBeenCalled();

    engine.play();
    engine.unlock();
    engine.unlock();
    expect(factory).toHaveBeenCalledOnce();
    engine.dispose();
  });

  it('reports the plan’s instruments as residents, with every memory event matching', async () => {
    const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });
    const bare = createAudioEngine({
      context,
      scheduleMemory: (run) => {
        run();
      },
    });
    expect(bare.memory()).toEqual({ decodedBytes: 0, budgetBytes: GM_BUDGET_BYTES, residents: [] });
    bare.dispose();

    const { engine } = await setup();
    const reports: ReturnType<AudioEngine['memory']>[] = [];
    engine.on('memory', (report) => reports.push(report));
    const { instruments } = await engine.load(quarters(1), GM);
    await engine.settled();
    const report = engine.memory();
    expect(report.residents).toEqual([...instruments].sort());
    expect(report.decodedBytes).toBeGreaterThan(0);
    expect(report.decodedBytes).toBeLessThanOrEqual(GM_BUDGET_BYTES);
    expect(reports.at(-1)).toEqual(report);

    engine.unload({ evict: true });
    expect(engine.memory()).toEqual({
      decodedBytes: 0,
      budgetBytes: GM_BUDGET_BYTES,
      residents: [],
    });
    engine.dispose();
  });

  it('applies setTrack during playback, without a state change, and keeps it after a stop', async () => {
    const song = quarters(4, { volume: 100 });
    const id = trackOf(song);
    const { engine, states, render, live } = await setup({ seconds: 3 });
    await engine.load(song, GM);
    engine.play();
    const { sampler } = live();
    let gain = 0;
    let statesAt = 0;

    const buffer = await render([
      {
        at: 1,
        run: () => {
          statesAt = states.length;
          engine.setTrack(id, { volume: 30 });
          gain = sampler.strip(id)?.gain ?? 0;
        },
      },
      {
        at: 2,
        run: () => {
          engine.setTrack(id, { mute: true });
        },
      },
    ]);

    expect(gain).toBeCloseTo(channelVolumeToGain(30), 9);
    expect(states).toHaveLength(statesAt);
    expect(rms(buffer, 1.1, 1.9)).toBeLessThan(0.3 * rms(buffer, 0.2, 0.9));
    expect(rms(buffer, 2.1, 2.9)).toBeLessThan(1e-5);
    engine.stop();
    expect(sampler.strip(id)?.gain).toBeCloseTo(channelVolumeToGain(30), 9);
    expect(sampler.strip(id)?.mute).toBe(true);
    engine.dispose();
  });

  it('previews a note past mute, and checks the song and the track', async () => {
    const unloaded = await setup({ lazy: true });
    expect(() => {
      unloaded.engine.previewNote('x', { string: 1, fret: 3 });
    }).toThrow(/load a score first/);
    const lazySong = quarters(1);
    await unloaded.engine.load(lazySong, GM);
    expect(() => {
      unloaded.engine.previewNote('nope', { string: 1, fret: 3 });
    }).toThrow(RangeError);
    unloaded.engine.previewNote(trackOf(lazySong), { string: 1, fret: 3 });
    expect(unloaded.factory).toHaveBeenCalledOnce();
    unloaded.engine.dispose();

    const song = quarters(1);
    const { engine, render } = await setup({ seconds: 0.8 });
    await engine.load(song, GM);
    engine.setTrack(trackOf(song), { mute: true });
    const buffer = await render([
      {
        at: 0.2,
        run: () => {
          engine.previewNote(trackOf(song), { string: 1, fret: 3 });
        },
      },
    ]);
    expect(rms(buffer, 0.21, 0.6)).toBeGreaterThan(1e-4);
    engine.dispose();
  });

  describe('a mixer change handed out before a cut', () => {
    // Bar 2 opens at 2.1 s with volume 20, handed out within the lookahead before 2.05 s.
    const mixed = (withChange: boolean) =>
      quarters(3, {
        volume: 100,
        beat: (bar, beat) =>
          withChange && bar === 1 && beat === 0 ? { mix: { volume: { value: 20 } } } : {},
      });

    async function previewAfter(cut: 'stop' | 'pause', withChange: boolean): Promise<number> {
      const song = mixed(withChange);
      const { engine, render } = await setup({ seconds: 3 });
      await engine.load(song, GM);
      engine.play();
      const buffer = await render([
        {
          at: 2.05,
          run: () => {
            engine[cut]();
          },
        },
        {
          at: 2.4,
          run: () => {
            engine.previewNote(trackOf(song), { string: 1, fret: 3 });
          },
        },
      ]);
      engine.dispose();
      return rms(buffer, 2.41, 2.9);
    }

    it.each(['stop', 'pause'] as const)('does not land after a %s', async (cut) => {
      const ratio = (await previewAfter(cut, true)) / (await previewAfter(cut, false));
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.25);
    });
  });

  describe('a mixer ramp running at a cut', () => {
    // Bar 2 ramps from volume 100 to 20 between 2.1 s and 3.1 s; every cut lands at 2.5 s.
    const ramped = (withChange: boolean) =>
      quarters(4, {
        volume: 100,
        beat: (bar, beat) =>
          withChange && bar === 1 && beat === 0
            ? { mix: { volume: { value: 20, duration: 2 } } }
            : {},
      });

    /** After a stop a preview sounds at 3.3 s; a seek or a resume from the top plays bar 1. */
    async function levelAfter(cut: 'stop' | 'pause' | 'seek', withChange: boolean) {
      const song = ramped(withChange);
      const { engine, render } = await setup({ seconds: 4 });
      await engine.load(song, GM);
      engine.play();
      const actions = {
        stop: [
          {
            at: 2.5,
            run: () => {
              engine.stop();
            },
          },
          {
            at: 3.3,
            run: () => {
              engine.previewNote(trackOf(song), { string: 1, fret: 3 });
            },
          },
        ],
        pause: [
          {
            at: 2.5,
            run: () => {
              engine.pause();
            },
          },
          {
            at: 2.6,
            run: () => {
              engine.play(0);
            },
          },
        ],
        seek: [
          {
            at: 2.5,
            run: () => {
              engine.seek(0);
            },
          },
        ],
      }[cut];
      const buffer = await render(actions);
      engine.dispose();
      return cut === 'stop' ? rms(buffer, 3.31, 3.8) : rms(buffer, 3.2, 3.9);
    }

    it.each(['stop', 'pause', 'seek'] as const)('does not land after a %s', async (cut) => {
      const ratio = (await levelAfter(cut, true)) / (await levelAfter(cut, false));
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.25);
    });
  });

  describe('a load over the loaded song', () => {
    const edited = (song: Score) =>
      applyCommand(song, setNote({ beatId: beatOf(song, 0, 2, 0).id }, { string: 1, fret: 5 }))
        .score;

    it('keeps playing from the same tick', async () => {
      const song = quarters(4);
      const { engine, states, positions, render } = await setup({ seconds: 1.7 });
      await engine.load(song, GM);
      engine.play();
      let before = 0;
      let after = 0;
      let statesAt = 0;

      const buffer = await render([
        {
          at: 1,
          run: () => {
            before = tickOf(positions) ?? 0;
            statesAt = states.length;
            void engine.load(edited(song), GM);
          },
        },
        {
          at: 1.05,
          run: () => {
            after = tickOf(positions) ?? 0;
          },
        },
      ]);

      expect(states.slice(statesAt)).not.toContain('stopped');
      expect(after).toBeGreaterThanOrEqual(before);
      expect(rms(buffer, 1.2, 1.6)).toBeGreaterThan(0.5 * rms(buffer, 0.3, 0.9));
      engine.dispose();
    });

    it('keeps a paused song paused at its tick, and resumes there', async () => {
      const song = quarters(4);
      const { engine, states, positions, render } = await setup({ seconds: 1.6 });
      await engine.load(song, GM);
      engine.play();
      let paused = 0;
      let afterLoad = 0;
      let resumed = 0;

      await render([
        {
          at: 1,
          run: () => {
            engine.pause();
            paused = tickOf(positions) ?? 0;
          },
        },
        {
          at: 1.1,
          run: () => {
            void engine.load(edited(song), GM);
            afterLoad = tickOf(positions) ?? 0;
          },
        },
        {
          at: 1.2,
          run: () => {
            engine.play();
            resumed = tickOf(positions) ?? 0;
          },
        },
      ]);

      expect(states).toEqual(['playing', 'paused', 'paused', 'playing']);
      expect(afterLoad).toBeCloseTo(paused, 6);
      expect(resumed).toBeCloseTo(paused, 6);
      engine.dispose();
    });
  });

  describe('a timeline-neutral edit', () => {
    it('reaches the strip at once, with no rebuild and no state change', async () => {
      const song = quarters(2);
      const id = trackOf(song);
      const { engine, states, render, live } = await setup({ seconds: 1.4 });
      await engine.load(song, GM);
      engine.play();
      const { sampler, transport } = live();
      const load = vi.spyOn(transport, 'load');
      let gain = 0;
      let statesAt = 0;

      await render([
        {
          at: 1,
          run: () => {
            statesAt = states.length;
            const next = applyCommand(
              song,
              setTrackProperties({ trackId: id }, { channel: { volume: 40 } }),
            ).score;
            void engine.load(next, GM);
            gain = sampler.strip(id)?.gain ?? 0;
          },
        },
      ]);

      expect(load).not.toHaveBeenCalled();
      expect(gain).toBeCloseTo(channelVolumeToGain(40), 9);
      expect(states.slice(statesAt)).toEqual([]);
      engine.dispose();
    });

    it('switches the instrument at once and reports its decode', async () => {
      const song = quarters(1);
      const id = trackOf(song);
      const { context, engine, live } = await setup();
      await engine.load(song, GM);
      engine.unlock();
      const { sampler, transport, bank } = live();
      const load = vi.spyOn(transport, 'load');
      const loads: InstrumentLoads[] = [];
      engine.on('instrumentLoads', (event) => loads.push(event));

      const next = applyCommand(song, setTrackProperties({ trackId: id }, { program: 0 })).score;
      const loading = engine.load(next, GM);
      const track = next.tracks[0];
      if (!track) throw new Error('no track');
      expect(sampler.instrumentAt(id, context.currentTime)).toBe(bank.instrument(track, 0));
      await expect(loading).resolves.toEqual({ instruments: [bank.instrumentId(track, 0)] });
      await engine.settled();

      expect(load).not.toHaveBeenCalled();
      expect(loads[0]?.[id]?.loaded).toBe(0);
      expect(loads[0]?.[id]?.total).toBeGreaterThan(0);
      expect(loads.at(-1)).toEqual({});
      expect(engine.memory().residents).toContain(bank.instrumentId(track, 0));
      engine.dispose();
    });
  });

  it('previews a strip without an override, until a run restores the channel', async () => {
    const song = quarters(1, { volume: 100 });
    const id = trackOf(song);
    const { engine, live } = await setup();
    await engine.load(song, GM);
    engine.unlock();
    const { sampler } = live();
    engine.previewTrack(id, { volume: 30 });
    expect(sampler.strip(id)?.gain).toBeCloseTo(channelVolumeToGain(30), 9);
    engine.play();
    engine.stop();
    expect(sampler.strip(id)?.gain).toBeCloseTo(channelVolumeToGain(100), 9);
    engine.dispose();
  });

  it('ends a song on unload, dropping its tracks, overrides and loop', async () => {
    const song = quarters(4);
    const id = trackOf(song);
    const [first, second] = song.masterBars;
    if (!first || !second) throw new Error('two bars expected');
    const { engine, states, positions, render, live } = await setup({ seconds: 1.2 });
    await engine.load(song, GM);
    engine.setTrack(id, { volume: 30 });
    engine.setLoop({ startBar: first.id, endBar: second.id });
    engine.play();
    const { sampler } = live();
    await render([
      {
        at: 1,
        run: () => {
          engine.unload();
        },
      },
    ]);
    expect(states.at(-1)).toBe('stopped');
    expect(sampler.trackIds).toEqual([]);

    const next = quarters(2, { volume: 100 });
    const nextId = trackOf(next);
    engine.setTrack(nextId, { mute: true });
    await engine.load(next, GM);
    expect(tickOf(positions)).toBe(0);
    expect(sampler.strip(nextId)?.mute).toBe(true);
    expect(sampler.strip(nextId)?.gain).toBeCloseTo(channelVolumeToGain(100), 9);
    expect(() => {
      engine.setLoop({ startBar: first.id, endBar: second.id });
    }).toThrow();
    engine.dispose();
  });

  it('keeps the settings given before the context and applies them when it is made', async () => {
    const song = quarters(1);
    const id = trackOf(song);
    const { engine, factory, states, live } = await setup({ lazy: true });
    engine.setTempo('percent', 50);
    engine.setCountIn(true);
    engine.setMetronome(true, 0.5);
    engine.setMasterVolume(0.5);
    engine.setTrack(id, { mute: true });
    expect(() => {
      engine.setMasterVolume(1.5);
    }).toThrow(RangeError);
    expect(() => {
      engine.setTempo('bpm', 0);
    }).toThrow(RangeError);
    expect(engine.outputLatency()).toBe(0);
    await engine.load(song, GM);
    engine.unlock();

    expect(factory).toHaveBeenCalledOnce();
    const { sampler } = live();
    expect(sampler.master.gain).toBe(0.5);
    expect(sampler.strip(id)?.mute).toBe(true);
    engine.play();
    expect(states.at(-1)).toBe('counting-in');
    engine.dispose();
  });

  it('needs one sound bank before a load', async () => {
    const context = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: 44_100 });
    const engine = createAudioEngine({ context });
    await expect(engine.load(quarters(1), GM)).rejects.toThrow(/setSoundfont/);
    const font = await synthetic();
    engine.setSoundfont(font);
    expect(() => {
      engine.setSoundfont(font);
    }).toThrow(/already/);
    engine.dispose();
  });

  it.skipIf(!generalUser)(
    'counts only the played preset and no eviction for an edit, on GeneralUser GS',
    async () => {
      if (!generalUser) return;
      const song = quarters(2);
      const { engine, live } = await setup({ font: generalUser });
      await engine.load(song, GM);
      await engine.settled();
      expect(engine.memory().residents).toEqual(['gm:0:25']);
      const { source } = live();
      const { evictions } = source.counters;

      await engine.load(
        applyCommand(song, setNote({ beatId: beatOf(song, 0, 1, 0).id }, { string: 1, fret: 5 }))
          .score,
        GM,
      );
      await engine.settled();
      expect(source.counters.evictions).toBe(evictions);
      engine.dispose();
    },
    60_000,
  );
});
