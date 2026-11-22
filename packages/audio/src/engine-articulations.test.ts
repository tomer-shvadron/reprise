import type { Id, Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import type { NoteSpec } from '@reprise/model/testing';
import { describe, expect, it, vi } from 'vitest';

import { createAudioEngine, debugAudioEngine } from './engine';
import type { LoadOptions } from './engine';
import { drive, manualTicker } from './offline-driver';
import { packInstrumentsOf } from './samples/provider-router';
import { Sf2Soundfont } from './sf2/soundfont';
import { rms, signalOf, toneLevel } from './test/signal';
import type { Signal } from './test/signal';
import {
  GUITAR_EXTRA_TONES,
  GUITAR_FILE_TONES,
  GUITAR_NOISES,
  GUITAR_TONES,
  syntheticGuitarPack,
} from './testing/synthetic-guitar-pack';
import type { SyntheticGuitarPack } from './testing/synthetic-guitar-pack';

const SAMPLE_RATE = 44_100;
const START = 0.1;
/** A quarter at 120 BPM. */
const BEAT = 0.5;
const SYNTHETIC = new URL('../test-fixtures/synthetic.sf2', import.meta.url);

let font: Promise<Sf2Soundfont> | undefined;
function synthetic(): Promise<Sf2Soundfont> {
  font ??= fetch(SYNTHETIC)
    .then((response) => response.arrayBuffer())
    .then((bytes) => Sf2Soundfont.parse(new Uint8Array(bytes)));
  return font;
}

async function setup(seconds: number) {
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
  });
  engine.setSoundfont(await synthetic());
  const render = () => drive(context, { tickers: [scheduler, frames] });
  return { engine, render };
}

/** String 1 tuned to A3: fret 12 is key 69 (the layers' key centre), and so is its natural harmonic. */
const TUNING = [57];

/** One quarter per spec, on string 1 at fret 12; a harmonic there sounds fret 12's key too. */
function song(...specs: NoteSpec[]): Score {
  let builder = score().tempo(120).track('guitar', { program: 25, tuning: TUNING }).bar();
  for (const [index, spec] of specs.entries()) {
    if (index > 0 && index % 4 === 0) builder = builder.bar();
    builder = builder.beat('4', [note(1, 12, spec)]);
  }
  return builder.build();
}

const trackOf = (built: Score): Id => built.tracks[0]?.id ?? '';

const options = (built: Score, pack: SyntheticGuitarPack, id = 'guitarpack01'): LoadOptions => ({
  tier: 'hq',
  packs: [{ trackId: trackOf(built), pack: { id, files: pack.files }, entries: pack.entries }],
});

const ALL_TONES = [
  GUITAR_TONES.default,
  GUITAR_TONES.palmMute,
  GUITAR_TONES.harmonic,
  GUITAR_TONES.legato,
  GUITAR_EXTRA_TONES.dead,
  GUITAR_EXTRA_TONES.staccato,
  GUITAR_FILE_TONES.palmMute,
  GUITAR_FILE_TONES.staccato,
];

/** The tone a beat sounds: the strongest of the pack's tones in the first 150 ms after its onset. */
function heard(signal: Signal, beat: number): number | undefined {
  const from = START + beat * BEAT + 0.03;
  const levels = ALL_TONES.map((hertz) => ({
    hertz,
    level: toneLevel(signal, hertz, from, from + 0.12),
  }));
  const [loudest] = [...levels].sort((a, b) => b.level - a.level);
  return loudest && loudest.level > 0.004 ? loudest.hertz : undefined;
}

async function played(
  built: Score,
  pack: SyntheticGuitarPack,
  beats: number,
): Promise<{ signal: Signal; engine: ReturnType<typeof createAudioEngine> }> {
  const { engine, render } = await setup(START + beats * BEAT + 0.3);
  await engine.load(built, options(built, pack));
  engine.play();
  return { signal: signalOf(await render()), engine };
}

describe('HQ articulation layers', () => {
  it('plays the layer of each articulation: palm mute, harmonic, hammer-on, dead note, staccato', async () => {
    const built = song(
      {},
      { palmMute: true },
      { harmonic: { kind: 'natural' } },
      { hammerPull: true },
      { dead: true },
      { staccato: true },
    );
    const { signal, engine } = await played(built, syntheticGuitarPack({ articulations: true }), 6);
    expect([0, 1, 2, 3, 4, 5].map((beat) => heard(signal, beat))).toEqual([
      GUITAR_TONES.default,
      GUITAR_TONES.palmMute,
      GUITAR_TONES.harmonic,
      GUITAR_TONES.legato,
      GUITAR_EXTRA_TONES.dead,
      GUITAR_EXTRA_TONES.staccato,
    ]);
    engine.dispose();
  });

  it('leaves out the automation a layer replaces: the palm-mute layer is not filtered or decayed', async () => {
    const layered = syntheticGuitarPack();
    const built = song({ palmMute: true });
    const { signal, engine } = await played(built, layered, 1);
    // Synthesized, a palm mute decays 18 dB over 250 ms; the layer's own sine stays level.
    const early = toneLevel(signal, GUITAR_TONES.palmMute, START + 0.02, START + 0.1);
    const late = toneLevel(signal, GUITAR_TONES.palmMute, START + 0.3, START + 0.4);
    expect(late).toBeGreaterThan(early * 0.8);
    engine.dispose();
  });

  it('falls back to the default layer with the synthesized articulation when the pack has no layer', async () => {
    // No `Dead Note` or `Staccato` layer: the dead note is the noise burst, staccato the sustain.
    const built = song({ dead: true }, { staccato: true });
    const { signal, engine } = await played(built, syntheticGuitarPack(), 2);
    expect(heard(signal, 0)).toBeUndefined();
    expect(heard(signal, 1)).toBe(GUITAR_TONES.default);
    engine.dispose();
  });

  it('plays a pack with no sets as it always did: the synthesized palm mute decays', async () => {
    // The reference guitar with its labels removed: its layers name no set, so only the default plays.
    const pack = syntheticGuitarPack();
    const files = {
      ...pack.files,
      read: async (path: string) => {
        const bytes = await pack.files.read(path);
        if (path !== 'default.sfz') return bytes;
        const text = new TextDecoder().decode(bytes).replaceAll(/sw_label=.*$/gm, '');
        return new TextEncoder().encode(text);
      },
    };
    const built = song({ palmMute: true });
    const { engine, render } = await setup(START + BEAT + 0.3);
    await engine.load(built, {
      tier: 'hq',
      packs: [
        { trackId: trackOf(built), pack: { id: 'plainpack001', files }, entries: pack.entries },
      ],
    });
    engine.play();
    const signal = signalOf(await render());
    const early = toneLevel(signal, GUITAR_TONES.default, START + 0.02, START + 0.1);
    expect(early).toBeGreaterThan(0.004);
    expect(toneLevel(signal, GUITAR_TONES.palmMute, START + 0.02, START + 0.1)).toBeLessThan(0.001);
    // The WP-033 decay stays: 18 dB down by 250 ms, so the tail is a fraction of the attack.
    expect(toneLevel(signal, GUITAR_TONES.default, START + 0.3, START + 0.4)).toBeLessThan(
      early * 0.3,
    );
    engine.dispose();
  });

  it('decodes only the layers the score plays', async () => {
    const without = syntheticGuitarPack();
    const plain = song({}, {});
    await (await played(plain, without, 2)).engine.settled();
    expect(without.reads.get('samples/default.wav')).toBeGreaterThan(0);
    expect(without.reads.get('samples/palmMute.wav')).toBeUndefined();
    expect(without.reads.get('samples/harmonic.wav')).toBeUndefined();

    const withMute = syntheticGuitarPack();
    const muted = song({ palmMute: true });
    await (await played(muted, withMute, 1)).engine.settled();
    expect(withMute.reads.get('samples/palmMute.wav')).toBeGreaterThan(0);
    expect(withMute.reads.get('samples/harmonic.wav')).toBeUndefined();
  });
});

describe('HQ articulation files', () => {
  it('plays a per-file set as an instrument of its own, resident before play', async () => {
    const pack = syntheticGuitarPack({ perFile: true });
    const built = song({}, { palmMute: true });
    const { engine, render } = await setup(START + 2 * BEAT + 0.3);
    await engine.load(built, options(built, pack));
    // Before play: the palm-muted beat's file is planned in, and the staccato file, unused, is not.
    expect([...packInstrumentsOf(engine.memory().residents, 'guitarpack01')].sort()).toEqual([
      'default.sfz',
      'gtr_pm.sfz',
    ]);
    expect(pack.reads.get('samples/file-stacc.wav')).toBeUndefined();
    engine.play();
    const signal = signalOf(await render());
    expect(heard(signal, 0)).toBe(GUITAR_TONES.default);
    expect(heard(signal, 1)).toBe(GUITAR_FILE_TONES.palmMute);
    expect(debugAudioEngine(engine).skippedEntries?.get(trackOf(built))).toEqual([]);
    engine.dispose();
  });

  it('loads the track again when a non-default entry changes, and not when only the key order does', async () => {
    const pack = syntheticGuitarPack({ perFile: true });
    const built = song({}, { palmMute: true });
    const { engine, render } = await setup(START + 2 * BEAT + 0.3);
    const pack_ = { id: 'guitarpack01', files: pack.files };
    const trackId = trackOf(built);
    await engine.load(built, {
      tier: 'hq',
      packs: [{ trackId, pack: pack_, entries: { default: 'default.sfz' } }],
    });
    expect(pack.reads.get('gtr_pm.sfz')).toBeUndefined();

    const entries = { default: 'default.sfz', palmMute: 'gtr_pm.sfz', staccato: 'gtr_stacc.sfz' };
    await engine.load(built, { tier: 'hq', packs: [{ trackId, pack: pack_, entries }] });
    expect([...packInstrumentsOf(engine.memory().residents, 'guitarpack01')].sort()).toEqual([
      'default.sfz',
      'gtr_pm.sfz',
    ]);
    const reads = pack.reads.get('gtr_pm.sfz');
    expect(reads).toBeGreaterThan(0);

    // The same entries in another key order are the same assignment: nothing is read again.
    // Two non-default keys, so the order matters to a key that is not sorted.
    const reordered = { staccato: 'gtr_stacc.sfz', palmMute: 'gtr_pm.sfz', default: 'default.sfz' };
    const swaps = vi.fn();
    const off = engine.on('instrumentLoads', swaps);
    await engine.load(built, { tier: 'hq', packs: [{ trackId, pack: pack_, entries: reordered }] });
    await engine.settled();
    off();
    expect(pack.reads.get('gtr_pm.sfz')).toBe(reads);
    // A reload would swap the track's instrument and report its decode.
    expect(swaps).not.toHaveBeenCalled();

    engine.play();
    const signal = signalOf(await render());
    expect(heard(signal, 1)).toBe(GUITAR_FILE_TONES.palmMute);
    engine.dispose();
  });

  it('ignores an entry that names no set, and drops a set whose file fails', async () => {
    const pack = syntheticGuitarPack({ perFile: true });
    const built = song({ palmMute: true });
    const { engine } = await setup(1);
    const result = await engine.load(built, {
      tier: 'hq',
      packs: [
        {
          trackId: trackOf(built),
          pack: { id: 'guitarpack01', files: pack.files },
          entries: { ...pack.entries, whistle: 'gtr_pm.sfz', harmonic: 'missing.sfz' },
        },
      ],
    });
    expect(result.fallbacks).toEqual([]);
    expect(debugAudioEngine(engine).skippedEntries?.get(trackOf(built))).toEqual([
      'harmonic',
      'whistle',
    ]);
    engine.dispose();
  });
});

describe('HQ dead notes on the muted-string noise keys of a pack', () => {
  const low = GUITAR_NOISES.tones[0];
  const high = GUITAR_NOISES.tones[3];
  const NOISE_TONES = GUITAR_NOISES.tones.flat();

  /** A six-string guitar, one quarter per `[string, spec]`: string 6 is the lowest. */
  function deadSong(...beats: [number, NoteSpec?][]): Score {
    let builder = score()
      .tempo(120)
      .track('guitar', { program: 25, tuning: [40, 45, 50, 55, 59, 64] })
      .bar();
    for (const [index, [string, spec]] of beats.entries()) {
      if (index > 0 && index % 4 === 0) builder = builder.bar();
      builder = builder.beat('4', [note(string, 12, { dead: true, ...spec })]);
    }
    return builder.build();
  }

  function heardNoise(signal: Signal, beat: number, tones: readonly number[] = NOISE_TONES) {
    const from = START + beat * BEAT + 0.03;
    const [loudest] = [...tones, ...ALL_TONES]
      .map((hertz) => ({ hertz, level: toneLevel(signal, hertz, from, from + 0.12) }))
      .sort((a, b) => b.level - a.level);
    return loudest && loudest.level > 0.004 ? loudest.hertz : undefined;
  }

  it('plays the noise of the string, not the pitch, and no release sample after it', async () => {
    const pack = syntheticGuitarPack({ noises: true });
    const built = deadSong([6], [1]);
    const { signal, engine } = await played(built, pack, 2);
    expect(heardNoise(signal, 0)).toBe(low[0]);
    expect(heardNoise(signal, 1)).toBe(high[0]);
    for (const beat of [0, 1]) {
      const from = START + beat * BEAT;
      expect(toneLevel(signal, GUITAR_TONES.release, from, from + BEAT)).toBeLessThan(0.004);
    }
    engine.dispose();
  });

  it('rotates the takes of a key through repeated dead notes on a string', async () => {
    const pack = syntheticGuitarPack({ noises: true });
    const built = deadSong([6], [6], [6]);
    const { signal, engine } = await played(built, pack, 3);
    expect([0, 1, 2].map((beat) => heardNoise(signal, beat))).toEqual([low[0], low[1], low[0]]);
    engine.dispose();
  });

  it('plays the noise for a ghost dead note, quieter, and for a palm-muted one at full level', async () => {
    const pack = syntheticGuitarPack({ noises: true });
    const built = deadSong([6], [6, { ghost: true }], [6, { palmMute: true }]);
    const { signal, engine } = await played(built, pack, 3);
    const level = (beat: number) => {
      const from = START + beat * BEAT + 0.03;
      return toneLevel(signal, low[beat % 2] ?? 0, from, from + 0.12);
    };
    expect([0, 1, 2].map((beat) => heardNoise(signal, beat))).toEqual([low[0], low[1], low[0]]);
    expect(level(1)).toBeLessThan(level(0));
    // Measured 1.00; a synthesized palm-mute decay would give about 0.45.
    expect(level(2)).toBeGreaterThan(level(0) * 0.9);
    engine.dispose();
  });

  it('beats a Dead Note keyswitch layer', async () => {
    const pack = syntheticGuitarPack({ noises: true, articulations: true });
    const { signal, engine } = await played(deadSong([6]), pack, 1);
    expect(heardNoise(signal, 0)).toBe(low[0]);
    engine.dispose();
  });

  it('reads the noises from a file of their own, resident before play', async () => {
    const pack = syntheticGuitarPack({ noises: 'file' });
    const built = deadSong([1]);
    const { engine, render } = await setup(START + BEAT + 0.3);
    await engine.load(built, options(built, pack));
    expect([...packInstrumentsOf(engine.memory().residents, 'guitarpack01')].sort()).toEqual([
      'default.sfz',
      'noises.sfz',
    ]);
    engine.play();
    expect(heardNoise(signalOf(await render()), 0)).toBe(high[0]);
    expect(debugAudioEngine(engine).skippedEntries?.get(trackOf(built))).toEqual([]);
    engine.dispose();
  });

  async function loadedWith(entries: Record<string, string>, pack: SyntheticGuitarPack) {
    const built = deadSong([6]);
    const { engine, render } = await setup(START + BEAT + 0.3);
    await engine.load(built, {
      tier: 'hq',
      packs: [
        {
          trackId: trackOf(built),
          pack: { id: 'guitarpack01', files: pack.files },
          entries: { ...pack.entries, ...entries },
        },
      ],
    });
    return {
      engine,
      render,
      skipped: debugAudioEngine(engine).skippedEntries?.get(trackOf(built)),
    };
  }

  it.each(['default.sfz#key:104', 'default.sfz#key:100-110', 'default.sfz#key:x'])(
    'drops the set for %s and plays the burst',
    async (dead) => {
      const { engine, render, skipped } = await loadedWith(
        { dead },
        syntheticGuitarPack({ noises: true }),
      );
      expect(skipped).toEqual(['dead']);
      engine.play();
      const signal = signalOf(await render());
      expect(heardNoise(signal, 0)).toBeUndefined();
      // The burst itself is heard: not silence.
      expect(rms(signal, START, START + 0.08)).toBeGreaterThan(0.001);
      engine.dispose();
    },
  );

  it('does not take a key only a legato region maps as covered', async () => {
    const pack = syntheticGuitarPack({ noises: true });
    const legatoOnly = new TextEncoder().encode(
      '<region> sample=samples/default.wav lokey=104 hikey=104 pitch_keycenter=104 trigger=legato\n',
    );
    const extended: SyntheticGuitarPack = {
      ...pack,
      files: {
        read: (path) =>
          path === 'legato-only.sfz' ? Promise.resolve(legatoOnly) : pack.files.read(path),
        size: (path) => (path === 'legato-only.sfz' ? legatoOnly.length : pack.files.size?.(path)),
      },
    };
    const { engine, skipped } = await loadedWith({ dead: 'legato-only.sfz#key:104' }, extended);
    expect(skipped).toEqual(['dead']);
    engine.dispose();
  });

  it('drops a key list on any set but dead', async () => {
    const { engine, skipped } = await loadedWith(
      { palmMute: 'default.sfz#key:100' },
      syntheticGuitarPack({ noises: true }),
    );
    expect(skipped).toEqual(['palmMute']);
    engine.dispose();
  });
});
