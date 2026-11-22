import type { Id, Score } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { createAudioEngine } from './engine';
import type { LoadOptions } from './engine';
import { drive, manualTicker } from './offline-driver';
import { Sf2Soundfont } from './sf2/soundfont';
import { loadGeneralUser, renderScore } from './test/harness';
import { peak, rms, signalOf, spectralCentroid } from './test/signal';
import type { Signal } from './test/signal';
import { syntheticGuitarPack } from './testing/synthetic-guitar-pack';

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
  return {
    engine,
    render: (actions: { at: number; run: () => void }[] = []) =>
      drive(context, { tickers: [scheduler, frames], actions }),
  };
}

/** One note on string 1 at fret 12 (the synthetic font's key centre) of the given length. */
function single(
  spec: Parameters<typeof note>[2] = {},
  effects: { golpe?: 'thumb' | 'finger' } = {},
  duration: '4' | '2' = '4',
): Score {
  return score()
    .tempo(120)
    .track('guitar', { program: 25, tuning: TUNING })
    .bar()
    .beat(duration, [note(1, 12, spec)], { effects })
    .build();
}

const trackOf = (built: Score): Id => built.tracks[0]?.id ?? '';

async function played(
  built: Score,
  options: (built: Score) => LoadOptions,
  seconds = START + BEAT + 0.4,
  actions: { at: number; run: (engine: ReturnType<typeof createAudioEngine>) => void }[] = [],
): Promise<Signal> {
  const { engine, render } = await setup(seconds);
  await engine.load(built, options(built));
  engine.play();
  const signal = signalOf(
    await render(
      actions.map((a) => ({
        at: a.at,
        run: () => {
          a.run(engine);
        },
      })),
    ),
  );
  engine.dispose();
  return signal;
}

const span = (from: number, to: number): [number, number] => [START + from, START + to];

/** The golpe on its own: the render with it minus the render without. */
function minus(withGolpe: Signal, without: Signal): Signal {
  return {
    sampleRate: withGolpe.sampleRate,
    data: withGolpe.data.map((value, index) => value - (without.data[index] ?? 0)),
  };
}

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

describe.each(tiers)('golpe on %s', (_name, options) => {
  it('sounds on a rest and on a note beat, and is gone before the next beat', async () => {
    const rest = score()
      .tempo(120)
      .track('guitar', { program: 25, tuning: TUNING })
      .bar()
      .rest('4', { effects: { golpe: 'thumb' } })
      .beat('4', [], { effects: { golpe: 'finger' } })
      .build();
    const signal = await played(rest, options, START + 2 * BEAT + 0.3);
    expect(rms(signal, ...span(0.005, 0.1))).toBeGreaterThan(0.005);
    expect(rms(signal, ...span(BEAT + 0.005, BEAT + 0.1))).toBeGreaterThan(0.005);
    expect(rms(signal, ...span(0.4, 0.49))).toBeLessThan(0.002);
  });

  it('plays only on a fretted track', async () => {
    const drums = score()
      .tempo(120)
      .track('drums')
      .bar()
      .rest('4', { effects: { golpe: 'thumb' } })
      .build();
    const keys = score()
      .tempo(120)
      .track('piano')
      .bar()
      .rest('4', { effects: { golpe: 'thumb' } })
      .build();
    for (const built of [drums, keys]) {
      const signal = await played(built, options);
      expect(peak(signal, 0, START + BEAT)).toBeLessThan(1e-4);
    }
  });
});

// The HQ tier's effects bus rings on after a stop, so only the dry GM path is silent at once.
describe('stopping on the GM tier', () => {
  const gm = (): LoadOptions => ({ tier: 'gm', packs: [] });
  it('stops a golpe and a ringing scrape at once', async () => {
    const both = single({ pickScrape: 'down' }, { golpe: 'thumb' }, '2');
    const stopAt = START + 0.15;
    const signal = await played(both, gm, START + 1.2, [
      {
        at: stopAt,
        run: (engine) => {
          engine.stop();
        },
      },
    ]);
    expect(rms(signal, ...span(0.02, 0.14))).toBeGreaterThan(0.005);
    expect(peak(signal, stopAt + 0.12, START + 1.2)).toBeLessThan(1e-4);
  });
});

const generalUser = await loadGeneralUser();

describe.skipIf(!generalUser)('golpe level on the GM tier (GeneralUser GS)', () => {
  const render = async (built: Score): Promise<Signal> => {
    if (!generalUser) throw new Error('GeneralUser GS is not present');
    return renderScore(built, { instruments: generalUser, sampleRate: SAMPLE_RATE, tail: 0.5 });
  };

  it.each(['thumb', 'finger'] as const)(
    'keeps the %s hit no louder than the note it lands on, plus 1 dB',
    async (kind) => {
      const plain = await render(single());
      const hit = await render(single({}, { golpe: kind }));
      const alone = minus(hit, plain);
      const window = span(0, 0.3);
      expect(peak(alone, ...window)).toBeGreaterThan(0.02);
      expect(peak(alone, ...window)).toBeLessThanOrEqual(peak(plain, ...window) * 10 ** (1 / 20));
    },
  );
});

describe.each(tiers)('pick scrape on %s', (_name, options) => {
  const half = (spec: Parameters<typeof note>[2]) => single(spec, {}, '2');
  const first = (signal: Signal) => spectralCentroid(signal, ...span(0.02, 0.12));
  const last = (signal: Signal) => spectralCentroid(signal, ...span(0.83, 0.93));
  const SECONDS = START + 1.2;

  it('sweeps the noise down for a down scrape: the last frame is at least half an octave lower', async () => {
    const signal = await played(half({ pickScrape: 'down' }), options, SECONDS);
    expect(first(signal)).toBeGreaterThan(last(signal) * 2 ** 0.5);
  });

  it('sweeps the noise up for an up scrape: the last frame is at least half an octave higher', async () => {
    const signal = await played(half({ pickScrape: 'up' }), options, SECONDS);
    expect(last(signal)).toBeGreaterThan(first(signal) * 2 ** 0.5);
  });

  it('replaces the pitched note: a noise scrape sounds, and the note after it still does', async () => {
    const signal = await played(half({ pickScrape: 'down' }), options, SECONDS);
    expect(rms(signal, ...span(0.02, 0.5))).toBeGreaterThan(0.003);
  });

  it('scrapes a dead note instead of cutting it to a burst, as Guitar Pro marks a pick slide', async () => {
    const signal = await played(half({ pickScrape: 'down', dead: true }), options, SECONDS);
    expect(rms(signal, ...span(0.3, 0.4))).toBeGreaterThan(0.003);
  });
});
