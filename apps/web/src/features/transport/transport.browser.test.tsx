import type { PlaybackState } from '@reprise/audio';
import { cleanup, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { timelineOf } from '@/state/timeline';
import { rms } from '@/test/offline';
import { player } from '@/test/player-harness';
import { fourBars } from '@/test/position';

import { describePosition } from './position-format';

function press(key: string, init: KeyboardEventInit = {}) {
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );
}

const space = () => {
  press(' ', { code: 'Space' });
};
const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function watchStates(p: ReturnType<typeof player>) {
  const states: PlaybackState[] = [];
  const unsubscribe = p.services.playback.subscribe((state, previous) => {
    if (state.transport !== previous.transport) states.push(state.transport);
  });
  return { states, unsubscribe };
}

describe('the transport bar on the real engine', () => {
  it('plays, pauses and resumes with Space, and the readout follows the audio clock', async () => {
    const p = player();
    await p.openScore(fourBars());
    const offline = p.prepare(3.1);
    const { states, unsubscribe } = watchStates(p);
    let paused: ReturnType<typeof describePosition> | undefined;
    const timeline = () => {
      const { score } = p.services.document.getState();
      if (!score) throw new Error('no score');
      return timelineOf(score);
    };

    space();
    const buffer = await p.renderAudio(offline, [
      {
        at: 1.35,
        run: () => {
          space();
          paused = describePosition(timeline(), p.services.playback.getState().position);
        },
      },
      { at: 1.85, run: space },
    ]);
    unsubscribe();

    expect(states).toEqual(['playing', 'paused', 'playing']);
    expect(paused).toMatchObject({ bar: '1/4', beat: '3/4' });
    expect(rms(buffer, 0.15, 1.3)).toBeGreaterThan(1e-4);
    expect(rms(buffer, 1.6, 1.85)).toBeLessThan(1e-5);
    expect(rms(buffer, 2.25, 3.0)).toBeGreaterThan(1e-4);

    await frame();
    await frame();
    const expected = describePosition(timeline(), p.services.playback.getState().position);
    const readout = screen.getByRole('group', { name: 'Position' });
    expect(readout.querySelector('[data-field="bar"]')).toHaveTextContent(expected.bar);
    expect(readout.querySelector('[data-field="beat"]')).toHaveTextContent(expected.beat);
    expect(readout.querySelector('[data-field="time"]')).toHaveTextContent(expected.time);
    p.services.dispose();
  });

  it('counts in one bar after Alt+C', async () => {
    const p = player();
    await p.openScore(fourBars());
    const offline = p.prepare(2.8);
    const { states, unsubscribe } = watchStates(p);
    let playingAt: number | undefined;
    const stop = p.services.playback.subscribe((state) => {
      if (state.transport === 'playing' && playingAt === undefined) playingAt = offline.currentTime;
    });

    press('c', { code: 'KeyC', altKey: true });
    expect(p.services.playback.getState().settings.countIn).toBe(true);
    space();
    const buffer = await p.renderAudio(offline);
    unsubscribe();
    stop();

    expect(states.slice(0, 2)).toEqual(['counting-in', 'playing']);
    expect(playingAt).toBeGreaterThanOrEqual(2.1);
    expect(playingAt).toBeLessThanOrEqual(2.15);
    expect(rms(buffer, 0.1, 0.14)).toBeGreaterThan(1e-4);
    p.services.dispose();
  });

  it('gives each player its own stored preferences', () => {
    const first = player();
    press('c', { code: 'KeyC', altKey: true });
    expect(first.services.playback.getState().settings.countIn).toBe(true);
    first.services.dispose();
    cleanup();

    const second = player();
    expect(second.services.playback.getState().settings.countIn).toBe(false);
    second.services.dispose();
  });
});
