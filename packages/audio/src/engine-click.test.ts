import { describe, expect, it } from 'vitest';

import { createAudioEngine } from './engine';
import { drive, manualTicker } from './offline-driver';
import { DEFAULT_CLICK_SETTINGS } from './standalone-click';
import type { ClickSettings } from './standalone-click';
import { peak, signalOf } from './test/signal';
import type { Signal } from './test/signal';

const SAMPLE_RATE = 44_100;
const START = 0.1;
/** The master bus limiter's lookahead, which every click carries. */
const BUS_DELAY = 264 / SAMPLE_RATE;

const settings = (partial: Partial<ClickSettings> = {}): ClickSettings => ({
  ...DEFAULT_CLICK_SETTINGS,
  volume: 1,
  ...partial,
});

function setup(seconds: number) {
  const context = new OfflineAudioContext({
    numberOfChannels: 2,
    length: Math.round(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
  });
  const scheduler = manualTicker();
  const frames = manualTicker();
  const engine = createAudioEngine({
    context,
    scheduler: scheduler.ticker,
    frames: frames.ticker,
    startLatency: START,
  });
  const render = (actions: { at: number; run: () => void }[] = []) =>
    drive(context, { tickers: [scheduler, frames], actions, step: 512 });
  return { engine, render };
}

/** Where each burst starts: the first sample over a floor after 40 ms of quiet. */
function onsets(signal: Signal, floor = 0.01): { at: number; level: number }[] {
  const found: { at: number; level: number }[] = [];
  let quietFrom = -Infinity;
  signal.data.forEach((value, index) => {
    const at = index / signal.sampleRate;
    if (Math.abs(value) < floor) return;
    if (at - quietFrom > 0.04) {
      found.push({ at, level: peak(signal, at, at + 0.03) });
    }
    quietFrom = at;
  });
  return found;
}

describe('the engine’s standalone click', () => {
  it('has no click without a song today: play needs a score, and the metronome rides on it', () => {
    const { engine } = setup(0.1);
    engine.setMetronome(true, 1);
    expect(() => {
      engine.play();
    }).toThrow('load a score first');
  });

  it.each([60, 120, 180])('puts the beats on the grid at %d bpm', async (bpm) => {
    const { engine, render } = setup(3);
    engine.startClick(settings({ bpm }));
    const heard = onsets(signalOf(await render()));
    const gap = 60 / bpm;
    expect(heard.length).toBeGreaterThanOrEqual(Math.floor(2.8 / gap));
    heard.forEach(({ at }, index) => {
      expect(Math.abs(at - (START + BUS_DELAY + index * gap))).toBeLessThan(0.001);
    });
  });

  it('is louder on the downbeat than on the other beats', async () => {
    const { engine, render } = setup(2);
    engine.startClick(settings({ bpm: 120, beatsPerBar: 4 }));
    const heard = onsets(signalOf(await render()));
    heard.slice(0, 8).forEach(({ level }, index) => {
      if (index % 4 === 0) expect(level).toBeGreaterThan(0.6);
      else expect(level).toBeLessThan(0.6);
    });
    const downbeat = heard[0]?.level ?? 0;
    expect(downbeat).toBeGreaterThan((heard[1]?.level ?? 1) * 1.5);
  });

  it('lands a tempo change on the next beat with no gap', async () => {
    const { engine, render } = setup(4);
    engine.startClick(settings({ bpm: 60 }));
    const heard = onsets(
      signalOf(
        await render([
          {
            at: 1.5,
            run: () => {
              engine.updateClick(settings({ bpm: 120 }));
            },
          },
        ]),
      ),
    );
    const gaps = heard.slice(1).map(({ at }, index) => at - (heard[index]?.at ?? 0));
    const firstFast = gaps.findIndex((gap) => gap < 0.75);
    expect(firstFast).toBeGreaterThan(0);
    for (const [index, gap] of gaps.entries()) {
      expect(Math.abs(gap - (index < firstFast ? 1 : 0.5))).toBeLessThan(0.002);
    }
    // The next beat after the change keeps its place; the gap after it is the new one.
    expect(heard[firstFast]?.at ?? Infinity).toBeLessThan(1.5 + 1 + 0.001 + START + BUS_DELAY);
  });

  it('stops the click and is silent after', async () => {
    const { engine, render } = setup(2);
    const events: boolean[] = [];
    engine.on('click', (running) => events.push(running));
    engine.startClick(settings({ bpm: 120 }));
    const buffer = await render([
      {
        at: 1,
        run: () => {
          engine.stopClick();
        },
      },
    ]);
    expect(events).toEqual([true, false]);
    expect(peak(signalOf(buffer), 1.1, 2)).toBeLessThan(0.001);
    expect(engine.click().running).toBe(false);
  });
});
