import { midiNote } from '@reprise/model';
import type { Score, Track } from '@reprise/model';
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

/** Every key of a 24-fret six-string guitar in standard tuning: MIDI 40 to 88. */
const GUITAR_KEYS = 49;

/** The distinct MIDI keys a track's notes strike. */
function keysOf(track: Track): Set<number> {
  const keys = new Set<number>();
  for (const bar of track.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) for (const n of beat.notes) keys.add(midiNote(track, n));
    }
  }
  return keys;
}

/**
 * The long score's bars and structure, with the pack tracks' notes walking all 150 string and
 * fret positions of a 24-fret guitar (`largeScore` moves string and fret in lockstep and so
 * reaches only 12 to 19 keys), and a GM program on each of the other tracks.
 */
function longScore(): { song: Score; options: LoadOptions } {
  const base = largeScore(8, 300, { structure: true });
  const song = {
    ...base,
    tracks: base.tracks.map((track, index): Track => {
      if (!(PACK_TRACKS as readonly number[]).includes(index)) {
        return { ...track, program: 25 + (index % 2) };
      }
      let counter = 0;
      return {
        ...track,
        fretCount: 24,
        // Only the first voice carries notes.
        bars: track.bars.map((bar) => ({
          ...bar,
          voices: [
            {
              ...bar.voices[0],
              beats: bar.voices[0].beats.map((beat) => ({
                ...beat,
                notes: beat.notes.map((n) => {
                  const position = counter++;
                  return { ...n, string: (position % 6) + 1, fret: Math.floor(position / 6) % 25 };
                }),
              })),
            },
            bar.voices[1],
            bar.voices[2],
            bar.voices[3],
          ],
        })),
      };
    }),
  };
  for (const index of PACK_TRACKS) {
    const track = song.tracks[index];
    if (!track || keysOf(track).size !== GUITAR_KEYS) {
      throw new Error(`track ${String(index)} does not reach every key of the guitar`);
    }
  }
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
 * distinct files each pack track reaches, the peak resident bytes and the fetches it had to wait for.
 */
async function playThrough(
  engine: ReturnType<typeof createAudioEngine>,
  song: Score,
): Promise<{ files: number[]; peak: number; misses: number }> {
  const { sampler, source } = debugAudioEngine(engine);
  if (!sampler || !source) throw new Error('the engine is not live');
  engine.unlock();
  const files: number[] = [];
  let peak = source.memory().decodedBytes;
  let misses = 0;
  for (const index of PACK_TRACKS) {
    const track = song.tracks[index];
    if (!track) continue;
    const instrument = sampler.instrumentAt(track.id, 0);
    const reached = new Set<string>();
    for (const key of keysOf(track)) {
      for (const velocity of [30, 100]) {
        for (const region of instrument.regions.candidates(key, velocity)) {
          reached.add(region.sample);
          if (!source.peekBuffer(region.sample)) {
            misses += 1;
            await source.getBuffer(region.sample);
          }
          peak = Math.max(peak, source.memory().decodedBytes);
        }
      }
    }
    files.push(reached.size);
  }
  return { files, peak, misses };
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
  // The worst case for four pack tracks: four distinct Swagbass-shaped packs sharing nothing, each
  // reached on every key of a 24-fret guitar at both velocity layers, on the long score's bars,
  // beside four GM tracks.
  it('holds the default 300 MiB with four distinct pack tracks reaching all 49 keys', async () => {
    const { song, options } = longScore();
    const engine = await setup();
    try {
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
        `HQ budget, four distinct pack tracks reaching ${String(GUITAR_KEYS)} keys each: ${mib(warm)} after warm-up, ` +
          `${mib(report.decodedBytes)} resident after a play-through (peak ${mib(played.peak)}) of ` +
          `${mib(report.budgetBytes)}; pack files per track ${played.files.join('/')}, ` +
          `${played.files.map((count) => mib(count * FILE_BYTES)).join(' / ')}, ` +
          `${String(gm.length)} GM instruments, ${String(source?.counters.fetches)} fetches, ` +
          `${String(Math.round(opened))} ms until load resolved, ${String(Math.round(settled))} ms until warm`,
      );

      expect(report.budgetBytes).toBe(HQ_BUDGET_BYTES);
      expect(result.fallbacks).toEqual([]);
      expect(packs).toEqual([['default.sfz'], ['default.sfz'], ['default.sfz'], ['default.sfz']]);
      expect(gm.length).toBeGreaterThan(0);
      // 49 keys at two velocity layers; the packs share nothing, so each file is its own buffer.
      expect(played.files).toEqual([
        2 * GUITAR_KEYS,
        2 * GUITAR_KEYS,
        2 * GUITAR_KEYS,
        2 * GUITAR_KEYS,
      ]);
      expect(report.decodedBytes).toBeGreaterThanOrEqual(4 * 2 * GUITAR_KEYS * FILE_BYTES);
      expect(report.decodedBytes).toBeLessThanOrEqual(HQ_BUDGET_BYTES);
      expect(played.peak).toBeLessThanOrEqual(HQ_BUDGET_BYTES);
      expect(played.misses).toBe(0);
      expect(source?.counters.evictions).toBe(0);
      expect(source?.counters.pinnedEvictions).toBe(0);
    } finally {
      engine.dispose();
    }
  });

  it('degrades under half its needs without throwing or exceeding the budget', async () => {
    const { song, options } = longScore();
    const full = await setup();
    let needed: number;
    try {
      await full.load(song, options);
      await full.settled();
      needed = full.memory().decodedBytes;
    } finally {
      full.dispose();
    }
    const budget = Math.floor(needed / 2);
    const engine = await setup(budget);
    try {
      const result = await engine.load(song, options);
      await engine.settled();
      const played = await playThrough(engine, song);
      const { source } = debugAudioEngine(engine);
      console.info(
        `HQ budget ${mib(budget)} for ${mib(needed)}: peak ${mib(played.peak)}, ` +
          `${String(played.misses)} misses, ${String(source?.counters.evictions)} evictions`,
      );
      expect(result.fallbacks).toEqual([]);
      expect(engine.memory().budgetBytes).toBe(budget);
      expect(engine.memory().decodedBytes).toBeLessThanOrEqual(budget);
      expect(played.peak).toBeLessThanOrEqual(budget);
      expect(played.misses).toBeGreaterThan(0);
      expect(source?.counters.evictions).toBeGreaterThan(0);
    } finally {
      engine.dispose();
    }
  });
});
