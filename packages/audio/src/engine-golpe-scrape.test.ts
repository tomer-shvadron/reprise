import type { Id, Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAudioEngine } from './engine';
import type { LoadOptions } from './engine';
import { drive, manualTicker } from './offline-driver';
import { Sf2Soundfont } from './sf2/soundfont';
import { rms, signalOf, toneLevel } from './test/signal';
import type { Signal } from './test/signal';
import { GUITAR_TONES, syntheticGuitarPack } from './testing/synthetic-guitar-pack';

const SAMPLE_RATE = 44_100;
const START = 0.1;
/** A quarter at 120 BPM. */
const BEAT = 0.5;
const SYNTHETIC = new URL('../test-fixtures/synthetic.sf2', import.meta.url);
const TUNING = [57];

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
  const bytes = await fetch(SYNTHETIC).then((response) => response.arrayBuffer());
  engine.setSoundfont(Sf2Soundfont.parse(new Uint8Array(bytes)));
  return { engine, render: () => drive(context, { tickers: [scheduler, frames] }) };
}

/**
 * Four quarters: a golpe on a rest, a golpe on a note, a scrape, and a plain note (string 1,
 * fret 12 is the synthetic font's key centre).
 */
function song(scraped: boolean): Score {
  return score()
    .tempo(120)
    .track('guitar', { program: 25, tuning: TUNING })
    .bar()
    .rest('4', { effects: { golpe: 'thumb' } })
    .beat('4', [], { effects: { golpe: 'finger' } })
    .beat('4', [note(1, 12, scraped ? { pickScrape: 'down' } : {})])
    .beat('4', [note(1, 12)])
    .build();
}

const trackOf = (built: Score): Id => built.tracks[0]?.id ?? '';

async function played(built: Score, options: (built: Score) => LoadOptions): Promise<Signal> {
  const { engine, render } = await setup(START + 4 * BEAT + 0.3);
  await engine.load(built, options(built));
  engine.play();
  const signal = signalOf(await render());
  engine.dispose();
  return signal;
}

const window = (beat: number, from = 0.01, to = 0.2): [number, number] => [
  START + beat * BEAT + from,
  START + beat * BEAT + to,
];

const tiers: [string, (built: Score) => LoadOptions][] = [
  ['the GM tier', () => ({ tier: 'gm', packs: [] })],
  [
    'an HQ pack',
    (built) => {
      const pack = syntheticGuitarPack();
      return {
        tier: 'hq',
        packs: [
          {
            trackId: trackOf(built),
            pack: { id: 'guitarpack01', files: pack.files },
            entries: pack.entries,
          },
        ],
      };
    },
  ],
];

describe.each(tiers)('golpe and pick scrape on %s', (_name, options) => {
  it('sounds a golpe on a rest and on a note beat, and goes quiet in between', async () => {
    const signal = await played(song(false), options);
    expect(rms(signal, ...window(0, 0.005, 0.1))).toBeGreaterThan(0.005);
    expect(rms(signal, ...window(1, 0.005, 0.1))).toBeGreaterThan(0.005);
    // The hit has decayed well before the next beat.
    expect(rms(signal, ...window(0, 0.4, 0.49))).toBeLessThan(0.002);
  });

  it('plays a scrape in place of the pitched note', async () => {
    const plain = await played(song(false), options);
    const scraped = await played(song(true), options);
    expect(rms(scraped, ...window(2))).toBeGreaterThan(0.005);
    // Same note either way, so the scrape beat differs only by what replaced the strike.
    const probe = (signal: Signal) => toneLevel(signal, GUITAR_TONES.default, ...window(2));
    expect(rms(scraped, ...window(2))).not.toBeCloseTo(rms(plain, ...window(2)), 3);
    if (probe(plain) > 0.004) expect(probe(scraped)).toBeLessThan(probe(plain) * 0.5);
    // The note after still sounds.
    expect(rms(scraped, ...window(3))).toBeGreaterThan(0.001);
  });
});
