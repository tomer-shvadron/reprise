import type { Id, Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import type { NoteSpec } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAudioEngine, debugAudioEngine } from './engine';
import type { LoadOptions } from './engine';
import { drive, manualTicker } from './offline-driver';
import { packInstrumentsOf } from './samples/provider-router';
import { Sf2Soundfont } from './sf2/soundfont';
import { signalOf, toneLevel } from './test/signal';
import type { Signal } from './test/signal';
import {
  GUITAR_EXTRA_TONES,
  GUITAR_FILE_TONES,
  GUITAR_TONES,
  syntheticGuitarPack,
} from './testing/synthetic-guitar-pack';
import type { SyntheticGuitarPack } from './testing/synthetic-guitar-pack';
import { syntheticSfzPack } from './testing/synthetic-pack';

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

  it('plays a pack with no sets as it always did', async () => {
    const plain = syntheticSfzPack({ frequency: 440 });
    const built = song({ palmMute: true });
    const { engine, render } = await setup(START + BEAT + 0.3);
    await engine.load(built, {
      tier: 'hq',
      packs: [
        {
          trackId: trackOf(built),
          pack: { id: 'plainpack001', files: plain.files },
          entries: { default: 'default.sfz' },
        },
      ],
    });
    engine.play();
    const signal = signalOf(await render());
    // The plain pack roots its sample at key 60, so key 69 sounds nine semitones up.
    expect(toneLevel(signal, 440 * 2 ** (9 / 12), START + 0.02, START + 0.1)).toBeGreaterThan(
      0.004,
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
