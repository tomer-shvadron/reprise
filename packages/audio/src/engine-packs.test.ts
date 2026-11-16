import { createTrack } from '@reprise/model';
import type { Id, Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import type { BeatSpec } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createAudioEngine, debugAudioEngine } from './engine';
import type { InstrumentLoads, LoadOptions } from './engine';
import { drive, manualTicker } from './offline-driver';
import type { Instrument } from './sampler/sampler';
import { packInstrumentsOf } from './samples/provider-router';
import { Sf2Soundfont } from './sf2/soundfont';
import { signalOf, toneLevel } from './test/signal';
import { encodeWav, sine } from './sfz/test/encode';
import { syntheticSfzPack } from './testing/synthetic-pack';

const SAMPLE_RATE = 44_100;
const START = 0.1;
const SYNTHETIC = new URL('../test-fixtures/synthetic.sf2', import.meta.url);
/** The pack's sample is played at key 67 (string 1, fret 3) from a root of 60: seven semitones up. */
const PACK_HZ = 300;
const HEARD_HZ = PACK_HZ * 2 ** (7 / 12);

let font: Promise<Sf2Soundfont> | undefined;
function synthetic(): Promise<Sf2Soundfont> {
  font ??= fetch(SYNTHETIC)
    .then((response) => response.arrayBuffer())
    .then((bytes) => Sf2Soundfont.parse(new Uint8Array(bytes)));
  return font;
}

/** Quarters on string 1, fret 3, program 25, at 120 BPM, on `tracks` fretted tracks. */
function quarters(bars: number, beat?: (bar: number, beat: number) => BeatSpec, tracks = 1): Score {
  const { channel } = createTrack('fretted');
  let builder = score().tempo(120);
  for (let index = 0; index < tracks; index++) {
    builder = builder.track('guitar', { program: 25, channel });
    for (let bar = 0; bar < bars; bar++) {
      builder = builder.bar();
      for (let beatIndex = 0; beatIndex < 4; beatIndex++) {
        builder = builder.beat('4', [note(1, 3)], beat?.(bar, beatIndex) ?? {});
      }
    }
  }
  return builder.build();
}

const twoTracks = (): [Score, Id, Id] => {
  const song = quarters(1, undefined, 2);
  const [a, b] = song.tracks.map((track) => track.id);
  if (!a || !b) throw new Error('two tracks expected');
  return [song, a, b];
};

async function setup(seconds = 1, engineOptions: { hqBudgetBytes?: number } = {}) {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const scheduler = manualTicker();
  const frames = manualTicker();
  const engine = createAudioEngine({
    context,
    scheduleMemory: (run) => {
      run();
    },
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: START,
    ...engineOptions,
  });
  engine.setSoundfont(await synthetic());
  const render = (actions: { at: number; run: () => void }[] = []) =>
    drive(context, { tickers: [scheduler, frames], actions });
  const live = () => {
    const { sampler, source } = debugAudioEngine(engine);
    if (!sampler || !source) throw new Error('the engine is not live');
    return { sampler, source };
  };
  return { engine, render, live };
}

const packOptions = (
  assignments: {
    trackId: Id;
    files: ReturnType<typeof syntheticSfzPack>['files'];
    id?: string;
    path?: string;
  }[],
): LoadOptions => ({
  tier: 'hq',
  packs: assignments.map(({ trackId, files, id = 'packone00001', path = 'default.sfz' }) => ({
    trackId,
    pack: { id, files },
    entries: { default: path },
  })),
});

/** Whether an instrument plays the pack's samples: its regions name `sfz:` refs. */
function isPack(instrument: Instrument): boolean {
  const regions = instrument.regions.candidates(67, 100);
  return regions.length > 0 && regions.every((region) => region.sample.startsWith('sfz:'));
}

const level = (buffer: AudioBuffer, from = 0.15, to = 0.45) =>
  toneLevel(signalOf(buffer), HEARD_HZ, from, to);

describe('HQ tracks play their pack', () => {
  it('renders the pack sample and not the GM one', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const pack = syntheticSfzPack({ frequency: PACK_HZ });

    const gm = await setup();
    await gm.engine.load(song, { tier: 'gm', packs: [] });
    gm.engine.play();
    const gmLevel = level(await gm.render());
    gm.engine.dispose();

    const hq = await setup();
    await hq.engine.load(song, packOptions([{ trackId: id, files: pack.files }]));
    hq.engine.play();
    const hqBuffer = await hq.render();
    expect(level(hqBuffer)).toBeGreaterThan(0.004);
    expect(level(hqBuffer)).toBeGreaterThan(5 * gmLevel);
    const { residents } = hq.engine.memory();
    expect(residents).toEqual(['sfz:packone00001:default.sfz']);
    expect(packInstrumentsOf(residents, 'packone00001')).toEqual(['default.sfz']);
    expect(packInstrumentsOf(residents, 'otherpack001')).toEqual([]);
    hq.engine.dispose();
  });

  it('leaves a GM track on the soundfont beside it', async () => {
    const [song, a, b] = twoTracks();
    const pack = syntheticSfzPack();
    const { engine, live } = await setup();
    await engine.load(song, packOptions([{ trackId: a, files: pack.files }]));
    engine.unlock();
    const { sampler } = live();
    expect(isPack(sampler.instrumentAt(a, 0))).toBe(true);
    expect(isPack(sampler.instrumentAt(b, 0))).toBe(false);
    // The pack track no longer plans a soundfont preset; the GM track's samples are resident.
    expect(engine.memory().residents).toEqual(['gm:0:25', 'sfz:packone00001:default.sfz'].sort());
    engine.dispose();
  });

  it('keeps the pack through a beat’s program change, in the planner and the sink', async () => {
    const song = quarters(2, (bar, beat) =>
      bar === 1 && beat === 0 ? { mix: { program: 30 } } : {},
    );
    const id = song.tracks[0]?.id ?? '';
    const pack = syntheticSfzPack({ frequency: PACK_HZ });
    const { engine, render, live } = await setup(2.2);
    await engine.load(song, packOptions([{ trackId: id, files: pack.files }]));
    // The planner never asked the soundfont for program 30.
    expect(engine.memory().residents).toEqual(['sfz:packone00001:default.sfz']);
    engine.play();
    const { sampler } = live();
    let after = true;
    const buffer = await render([
      {
        at: 1.5,
        run: () => {
          after = isPack(sampler.instrumentAt(id, 1.6));
        },
      },
    ]);
    expect(after).toBe(true);
    expect(level(buffer, 1.15, 1.45)).toBeGreaterThan(0.004);
    engine.dispose();
  });

  it('keeps the pack through a loop wrap and a stop', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const bar = song.masterBars[0]?.id ?? '';
    const pack = syntheticSfzPack({ frequency: PACK_HZ });
    const { engine, render, live } = await setup(3);
    await engine.load(song, packOptions([{ trackId: id, files: pack.files }]));
    engine.unlock();
    const { sampler } = live();
    const given: Instrument[] = [];
    const original = sampler.setInstrument.bind(sampler);
    vi.spyOn(sampler, 'setInstrument').mockImplementation((track, instrument, at) => {
      if (track === id) given.push(instrument);
      original(track, instrument, at);
    });
    engine.setLoop({ startBar: bar, endBar: bar });
    engine.play();
    const buffer = await render([
      {
        at: 2.6,
        run: () => {
          engine.stop();
        },
      },
    ]);
    // Each run start, loop wrap and the stop reset the baseline, and each puts the pack back.
    expect(given.length).toBeGreaterThanOrEqual(3);
    expect(given.every(isPack)).toBe(true);
    expect(isPack(sampler.instrumentAt(id, 3))).toBe(true);
    expect(level(buffer, 2.15, 2.45)).toBeGreaterThan(0.004);
    engine.dispose();
  });
});

describe('a same-score load with other packs', () => {
  it('swaps only the changed track and reports its decode', async () => {
    const [song, a, b] = twoTracks();
    const one = syntheticSfzPack();
    const two = syntheticSfzPack();
    const { engine, live } = await setup();
    await engine.load(
      song,
      packOptions([
        { trackId: a, files: one.files, id: 'packone00001' },
        { trackId: b, files: two.files, id: 'packtwo00001' },
      ]),
    );
    engine.unlock();
    const { sampler } = live();
    const untouched = sampler.instrumentAt(a, 0);
    const before = sampler.instrumentAt(b, 0);
    const loads: InstrumentLoads[] = [];
    engine.on('instrumentLoads', (current) => loads.push(current));

    await engine.load(
      song,
      packOptions([
        { trackId: a, files: one.files, id: 'packone00001' },
        { trackId: b, files: two.files, id: 'packtwo00001', path: 'alt.sfz' },
      ]),
    );
    expect(sampler.instrumentAt(a, 0)).toBe(untouched);
    expect(sampler.instrumentAt(b, 0)).not.toBe(before);
    expect(isPack(sampler.instrumentAt(b, 0))).toBe(true);
    expect(loads.some((current) => b in current)).toBe(true);
    expect(loads.some((current) => a in current)).toBe(false);
    expect(engine.memory().residents).toContain('sfz:packtwo00001:alt.sfz');

    // Without its assignment the track is GM again.
    await engine.load(song, packOptions([{ trackId: a, files: one.files, id: 'packone00001' }]));
    expect(isPack(sampler.instrumentAt(b, 0))).toBe(false);
    expect(isPack(sampler.instrumentAt(a, 0))).toBe(true);
    engine.dispose();
  });

  it('plays a reinstalled pack, a new files object under the same id', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const first = syntheticSfzPack({ frequency: 200 });
    const second = syntheticSfzPack({ frequency: PACK_HZ });
    const { engine, render, live } = await setup();
    await engine.load(song, packOptions([{ trackId: id, files: first.files }]));
    await engine.load(song, packOptions([{ trackId: id, files: second.files }]));
    engine.play();
    expect(live().sampler.instrumentAt(id, 0)).toBeDefined();
    expect(level(await render())).toBeGreaterThan(0.004);
    engine.dispose();
  });
});

describe('a pack that cannot load', () => {
  it('plays GM when the SFZ is missing', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const pack = syntheticSfzPack({ frequency: PACK_HZ });
    const { engine, render, live } = await setup();
    const result = await engine.load(
      song,
      packOptions([{ trackId: id, files: pack.files, path: 'nope.sfz' }]),
    );
    expect(result.fallbacks.map((entry) => entry.trackId)).toEqual([id]);
    engine.play();
    const buffer = await render();
    expect(isPack(live().sampler.instrumentAt(id, 0))).toBe(false);
    expect(level(buffer)).toBeLessThan(0.002);
    engine.dispose();
  });

  it('plays GM when a sample file is missing, and still resolves', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const pack = syntheticSfzPack();
    const files = {
      ...pack.files,
      read: (path: string) =>
        path === 'samples/a.wav' ? Promise.reject(new Error('gone')) : pack.files.read(path),
    };
    const { engine, live } = await setup();
    const result = await engine.load(song, packOptions([{ trackId: id, files }]));
    expect(result.fallbacks).toHaveLength(1);
    expect(result.fallbacks[0]).toMatchObject({ trackId: id, packId: 'packone00001' });
    expect(result.fallbacks[0]?.error).toContain('gone');
    engine.unlock();
    expect(isPack(live().sampler.instrumentAt(id, 0))).toBe(false);
    expect(debugAudioEngine(engine).assignments?.size).toBe(0);
    expect(engine.memory().residents).toEqual(['gm:0:25']);
    engine.dispose();
  });
});

describe('the HQ budget', () => {
  it('counts the pack’s buffers in the memory report and the budget of the tier', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const pack = syntheticSfzPack({ sampleRate: 22_050 });
    const { engine, live } = await setup(1, { hqBudgetBytes: 1024 * 1024 });
    await engine.load(song, packOptions([{ trackId: id, files: pack.files }]));
    await engine.settled();
    const report = engine.memory();
    expect(report.budgetBytes).toBe(1024 * 1024);
    // 0.1 s of mono Float32 at 22,050 Hz.
    expect(report.decodedBytes).toBe(Math.round(0.1 * 22_050) * 4);
    expect(live().source.counters.pinnedEvictions).toBe(0);
    engine.dispose();
  });

  it('evicts the pack under pressure like any other instrument', async () => {
    const song = quarters(1);
    const id = song.tracks[0]?.id ?? '';
    const pack = syntheticSfzPack();
    const { engine } = await setup(1, { hqBudgetBytes: 1024 * 1024 });
    await engine.load(song, packOptions([{ trackId: id, files: pack.files }]));
    expect(engine.memory().residents).toContain('sfz:packone00001:default.sfz');
    // Back on GM with no pack: the pack instrument is a leftover, and unloading frees it.
    await engine.load(song, { tier: 'gm', packs: [] });
    engine.unload({ evict: true });
    expect(engine.memory()).toMatchObject({ decodedBytes: 0, residents: [] });
    engine.dispose();
  });
});

describe('a Swagbass-sized pack with seven GM tracks', () => {
  const MIB = 1024 * 1024;

  it(
    'stays under the HQ budget, and reports its load time and resident bytes',
    { timeout: 120_000 },
    async () => {
      // 254 files of 4.3 s mono at 44.1 kHz: 184 MiB decoded, the shape WP-090 measured for Swagbass.
      const rate = 44_100;
      const wav = encodeWav([sine(110, rate, 4.3)], rate);
      const lines: string[] = [];
      for (let key = 0; key < 127; key++) {
        for (const [lo, hi] of [
          [1, 63],
          [64, 127],
        ] as const) {
          lines.push(
            `<region> sample=s/${String(key)}-${String(lo)}.wav lokey=${String(key)} hikey=${String(key)} lovel=${String(lo)} hivel=${String(hi)} pitch_keycenter=${String(key)}`,
          );
        }
      }
      const sfz = new TextEncoder().encode(lines.join('\n'));
      const files = {
        read: (path: string) =>
          path === 'default.sfz'
            ? Promise.resolve(sfz)
            : path.startsWith('s/')
              ? Promise.resolve(wav)
              : Promise.reject(new Error(`No file ${path}`)),
        size: (path: string) => (path.startsWith('s/') ? wav.length : undefined),
      };

      // Track 0 plays every fret on every string, reaching 48 keys and 96 of the pack's files; seven
      // more play one note.
      let builder = score().tempo(120).track('guitar', { program: 25 });
      for (let bar = 0; bar < 6; bar++) {
        builder = builder.bar();
        for (let beat = 0; beat < 4; beat++) {
          const fret = bar * 4 + beat;
          builder = builder.beat(
            '4',
            [1, 2, 3, 4, 5, 6].map((string) => note(string, fret)),
          );
        }
      }
      for (let index = 0; index < 7; index++) {
        builder = builder.track('guitar', { program: 25 + index });
        for (let bar = 0; bar < 6; bar++) {
          builder = builder.bar();
          for (let beat = 0; beat < 4; beat++) builder = builder.beat('4', [note(1, 3)]);
        }
      }
      const song = builder.build();
      const hq = song.tracks[0]?.id ?? '';
      const { engine, live } = await setup(1);
      const started = performance.now();
      const result = await engine.load(song, packOptions([{ trackId: hq, files }]));
      const opened = performance.now() - started;
      await engine.settled();
      const settled = performance.now() - started;
      const report = engine.memory();
      const pack = packInstrumentsOf(report.residents, 'packone00001');
      console.info(
        `HQ track measured: ${String(Math.round(opened))} ms until load resolved, ${String(Math.round(settled))} ms until warm, ` +
          `${(report.decodedBytes / MIB).toFixed(1)} MiB resident of ${String(report.budgetBytes / MIB)} MiB ` +
          `(${String(pack.length)} pack instrument, ${String(report.residents.length - pack.length)} GM), ` +
          `${String(live().source.counters.fetches)} fetches`,
      );
      expect(result.fallbacks).toEqual([]);
      expect(pack).toEqual(['default.sfz']);
      expect(report.residents).toContain('gm:0:25');
      expect(report.decodedBytes).toBeLessThanOrEqual(300 * MIB);
      expect(live().source.counters.pinnedEvictions).toBe(0);
      engine.dispose();
    },
  );
});
