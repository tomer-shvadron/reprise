import { midiNote } from '@reprise/model';
import type { Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAudioEngine, debugAudioEngine } from './engine';
import type { LoadOptions } from './engine';
import { manualTicker } from './offline-driver';
import { HQ_BUDGET_BYTES, MEGABYTE, packInstrumentsOf } from './samples';
import { Sf2Soundfont } from './sf2/soundfont';
import { encodeWav, sine } from './sfz/test/encode';

const RATE = 44_100;
const SYNTHETIC = new URL('../test-fixtures/synthetic.sf2', import.meta.url);
/** Tracks that play a pack: every other one of the eight, so the packs share nothing. */
const PACK_TRACKS = [0, 2, 4, 6] as const;
/** One Swagbass-shaped file: 4.3 s of mono Float32 at 44.1 kHz. */
const FILE_BYTES = Math.round(4.3 * RATE) * 4;

const mib = (bytes: number) => `${(bytes / MEGABYTE).toFixed(1)} MiB`;

/**
 * A Swagbass-shaped pack, as WP-090 measured it and #273 reused: 127 keys by two velocity layers
 * (254 files of 4.3 s). Each call returns its own files object, so a pack never shares buffers.
 */
function swagbassShaped() {
  const wav = encodeWav([sine(110, RATE, 4.3)], RATE);
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
  return {
    read: (path: string) =>
      path === 'default.sfz'
        ? Promise.resolve(sfz)
        : path.startsWith('s/')
          ? Promise.resolve(wav)
          : Promise.reject(new Error(`No file ${path}`)),
    size: (path: string) => (path.startsWith('s/') ? wav.length : undefined),
  };
}

/** The long score with a pack on tracks 0, 2, 4 and 6 and a GM program on each of the others. */
function longScore(): { song: Score; options: LoadOptions } {
  const base = largeScore(8, 300, { structure: true });
  const song = {
    ...base,
    tracks: base.tracks.map((track, index) => ({ ...track, program: 25 + (index % 2) })),
  };
  return {
    song,
    options: {
      tier: 'hq',
      packs: PACK_TRACKS.map((index) => ({
        trackId: song.tracks[index]?.id ?? '',
        pack: { id: `swagbass${String(index).padStart(4, '0')}`, files: swagbassShaped() },
        entries: { default: 'default.sfz' },
      })),
    },
  };
}

/**
 * Plays the whole song's pack notes through the source, as the scheduler would reach them: the
 * warm-up plans the opening bars, so the full figure is what a play-through pulls in. Returns the
 * count of distinct files the song's keys reach and the peak resident bytes.
 */
async function playThrough(
  engine: ReturnType<typeof createAudioEngine>,
  song: Score,
): Promise<{ files: number; peak: number; misses: number }> {
  const { sampler, source } = debugAudioEngine(engine);
  if (!sampler || !source) throw new Error('the engine is not live');
  engine.unlock();
  const files = new Set<string>();
  let peak = source.memory().decodedBytes;
  let misses = 0;
  for (const index of PACK_TRACKS) {
    const track = song.tracks[index];
    if (!track) continue;
    const instrument = sampler.instrumentAt(track.id, 0);
    const keys = new Set<number>();
    for (const bar of track.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) for (const n of beat.notes) keys.add(midiNote(track, n));
      }
    }
    for (const key of keys) {
      for (const velocity of [30, 100]) {
        for (const region of instrument.regions.candidates(key, velocity)) {
          files.add(region.sample);
          if (!source.peekBuffer(region.sample)) {
            misses += 1;
            await source.getBuffer(region.sample);
          }
          peak = Math.max(peak, source.memory().decodedBytes);
        }
      }
    }
  }
  return { files: files.size, peak, misses };
}

async function setup(hqBudgetBytes?: number) {
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: RATE, sampleRate: RATE });
  const engine = createAudioEngine({
    context,
    scheduleMemory: (run) => {
      run();
    },
    scheduler: manualTicker().ticker,
    frames: manualTicker().ticker,
    ...(hqBudgetBytes === undefined ? {} : { hqBudgetBytes }),
  });
  const font = await fetch(SYNTHETIC)
    .then((response) => response.arrayBuffer())
    .then((bytes) => Sf2Soundfont.parse(new Uint8Array(bytes)));
  engine.setSoundfont(font);
  return engine;
}

describe('HQ-tier memory budget', () => {
  // The worst case for four pack tracks: four distinct Swagbass-shaped packs sharing nothing, on
  // the long score, beside four GM tracks. The song reaches about 130 of the 1,016 files, 94 MiB.
  it(
    'holds the default 300 MiB with four distinct pack tracks on the long score',
    { timeout: 30_000 },
    async () => {
      const { song, options } = longScore();
      const engine = await setup();
      const started = performance.now();
      const result = await engine.load(song, options);
      const opened = performance.now() - started;
      await engine.settled();
      const settled = performance.now() - started;
      const warm = engine.memory().decodedBytes;
      const played = await playThrough(engine, song);
      const report = engine.memory();
      const { source } = debugAudioEngine(engine);
      const packs = options.packs.map(({ pack }) => packInstrumentsOf(report.residents, pack.id));
      const gm = report.residents.filter((id) => id.startsWith('gm:'));
      console.info(
        `HQ budget, four distinct pack tracks on largeScore(8, 300): ${mib(warm)} after warm-up, ` +
          `${mib(report.decodedBytes)} resident after a play-through (peak ${mib(played.peak)}) of ` +
          `${mib(report.budgetBytes)}; ${String(played.files)} pack files reached, ` +
          `${mib((played.files * FILE_BYTES) / 4)} per pack track, ${String(gm.length)} GM instruments, ` +
          `${String(source?.counters.fetches)} fetches, ${String(Math.round(opened))} ms until load resolved, ` +
          `${String(Math.round(settled))} ms until warm`,
      );

      expect(report.budgetBytes).toBe(HQ_BUDGET_BYTES);
      expect(HQ_BUDGET_BYTES).toBe(300 * MEGABYTE);
      expect(result.fallbacks).toEqual([]);
      expect(packs).toEqual([['default.sfz'], ['default.sfz'], ['default.sfz'], ['default.sfz']]);
      expect(gm.length).toBeGreaterThan(0);
      // The four packs share nothing, so each reached file is its own buffer.
      expect(played.files).toBeGreaterThan(4 * 10);
      expect(report.decodedBytes).toBeGreaterThanOrEqual(played.files * FILE_BYTES);
      expect(played.peak).toBeLessThanOrEqual(HQ_BUDGET_BYTES);
      expect(source?.counters.evictions).toBe(0);
      expect(source?.counters.pinnedEvictions).toBe(0);
      engine.dispose();
    },
  );

  it(
    'degrades under half its needs without throwing or exceeding the budget',
    { timeout: 30_000 },
    async () => {
      const { song, options } = longScore();
      // Under half of the 94 MiB the song's pack files need.
      const half = 40 * MEGABYTE;
      const engine = await setup(half);
      const result = await engine.load(song, options);
      await engine.settled();
      const report = engine.memory();
      console.info(
        `HQ budget ${mib(half)} for the same song: ${mib(report.decodedBytes)} resident, ` +
          `${String(debugAudioEngine(engine).source?.counters.evictions)} evictions`,
      );
      expect(result.fallbacks).toEqual([]);
      expect(report.budgetBytes).toBe(half);
      expect(report.decodedBytes).toBeLessThanOrEqual(half);
      expect(debugAudioEngine(engine).source?.counters.evictions).toBeGreaterThan(0);
      engine.dispose();
    },
  );
});
