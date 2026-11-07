import { write } from '@reprise/formats';
import { beatTicks, positionAtSeconds, secondsAtTick, type Score } from '@reprise/model';
import { largeScore } from '@reprise/model/testing';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Profiler } from 'react';
import { describe, expect, it } from 'vitest';

import { playheadAt } from '@/features/score';
import { mirrorAudio } from '@/test/mirror-audio';
import { seekTick } from '@/features/transport/seek';
import { timelineOf } from '@/state/timeline';
import { createTestServices } from '@/test/services';

import { App } from './app';

/** A beat's master bar and its start in its voice. */
function beatStart(score: Score, id: string): { masterBarIndex: number; tick: number } {
  for (const track of score.tracks) {
    for (const [masterBarIndex, bar] of track.bars.entries()) {
      for (const voice of bar.voices) {
        let tick = 0;
        for (const beat of voice.beats) {
          if (beat.id === id) return { masterBarIndex, tick };
          tick += beatTicks(beat);
        }
      }
    }
  }
  throw new Error(`no beat ${id}`);
}

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function region(): HTMLElement {
  return screen.getByRole('region', { name: /^Score: / });
}

function line(): HTMLElement {
  const found = region().querySelector<HTMLElement>('.score-cursor');
  if (!found) throw new Error('no playhead');
  return found;
}

const lineX = () => Number(/translate\(([-\d.]+)px/.exec(line().style.transform)?.[1]);

function lineInView(): boolean {
  const view = region().getBoundingClientRect();
  const drawn = line().getBoundingClientRect();
  return (
    drawn.left >= view.left &&
    drawn.right <= view.right &&
    drawn.top >= view.top - 1 &&
    drawn.bottom <= view.bottom + 1
  );
}

// The test project builds no Tailwind, so the region gets the height the app frame gives it.
const frameStyle = Object.assign(document.createElement('style'), {
  textContent: '.score-view { position: relative; height: 760px; overflow: auto; }',
});

async function setup() {
  document.head.append(frameStyle);
  const services = createTestServices();
  mirrorAudio(services);
  let commits = 0;
  render(
    <Profiler id="app" onRender={() => (commits += 1)}>
      <div style={{ width: 1280, height: 800 }}>
        <App services={services} keyboard="mac" />
      </div>
    </Profiler>,
  );
  const song: Score = largeScore(2, 40, { structure: true });
  await act(async () => {
    await services.document
      .getState()
      .openBytes('long.reprise', (await write(song, 'reprise')).bytes);
  });
  await waitFor(() => {
    expect(region()).toHaveAttribute('aria-busy', 'false');
    expect(region().querySelector('[data-system-id]')).not.toBeNull();
  });
  const score = services.document.getState().score;
  const result = services.layout.getState().result;
  if (!score || !result) throw new Error('not open');
  const { map } = timelineOf(score);
  /** The fake clock: the engine's position event at `seconds`, written as the service would. */
  const clock = (seconds: number, transport: 'playing' | 'paused' = 'playing') => {
    const position = positionAtSeconds(map, seconds);
    const masterBar = position && score.masterBars[position.masterBarIndex];
    if (!position || !masterBar) throw new Error('no position');
    services.playback.setState({
      transport,
      position: { position, masterBarId: masterBar.id, seconds, countingIn: false },
    });
    return { position, masterBar };
  };
  return { services, score, result, map, clock, commits: () => commits };
}

describe('the playhead in the app', () => {
  it('moves with the clock without React, turns the page, pauses on a hand scroll and seeks on a click', async () => {
    const { services, score, result, map, clock, commits } = await setup();
    clock(0);
    for (let i = 0; i < 3; i++) await frame();

    // 20 frames of playback.
    const before = commits();
    const xs: number[] = [];
    let seconds = 0;
    let last: ReturnType<typeof clock> | undefined;
    for (let i = 0; i < 20; i++) {
      seconds += 1 / 60;
      last = clock(seconds);
      await frame();
      xs.push(lineX());
    }
    expect(commits() - before).toBe(0);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] ?? Infinity);
    const expected = last && playheadAt(result, score, last.masterBar.id, last.position.tick);
    expect(xs.at(-1)).toBeCloseTo((expected?.x ?? 0) - 1, 3);

    // A page turn: the playhead enters a system the window shows only in part.
    const view = region().getBoundingClientRect();
    const partly = result.systems.find((system) => {
      const svg = region().querySelector(`[data-system-id="${system.id}"]`);
      const box = svg?.getBoundingClientRect();
      return box !== undefined && box.bottom > view.bottom;
    });
    if (!partly) throw new Error('no system below the fold');
    const pass = map.passes.find((p) => p.masterBarIndex === partly.bars.start);
    if (!pass) throw new Error('no pass');
    clock(secondsAtTick(map, pass.startTick) + 0.01);
    await waitFor(() => {
      expect(region().scrollTop).toBeGreaterThan(0);
      expect(lineInView()).toBe(true);
    });

    // A hand scroll pauses following, and the button brings it back.
    region().dispatchEvent(new WheelEvent('wheel', { deltaY: -400, bubbles: true }));
    region().scrollTop = 0;
    await waitFor(() => {
      expect(services.ui.getState().follow.on).toBe(false);
    });
    const farther = map.passes.find((p) => p.masterBarIndex === partly.bars.start + 8);
    clock(secondsAtTick(map, farther?.startTick ?? 0));
    for (let i = 0; i < 5; i++) await frame();
    expect(region().scrollTop).toBe(0);
    screen.getByRole('button', { name: 'Follow playback' }).click();
    // The engine writes a position every frame while playing; the next one follows.
    clock(secondsAtTick(map, farther?.startTick ?? 0) + 0.01);
    await waitFor(() => {
      expect(lineInView()).toBe(true);
    });

    // Paused, a click on a beat seeks there and the playhead lands on it.
    clock(secondsAtTick(map, farther?.startTick ?? 0), 'paused');
    await frame();
    const canvas = region().querySelector<HTMLElement>('.score-canvas');
    if (!canvas) throw new Error('no canvas');
    const origin = canvas.getBoundingClientRect();
    const beat = result.anchors.find((anchor) => {
      if (anchor.kind !== 'beat') return false;
      const x = origin.left + anchor.bbox.x + anchor.bbox.width / 2;
      const y = origin.top + anchor.bbox.y + anchor.bbox.height / 2;
      const box = region().getBoundingClientRect();
      return x > box.left && x < box.right - 20 && y > box.top && y < box.bottom - 20;
    });
    if (!beat) throw new Error('no visible beat');
    const at = {
      clientX: origin.left + beat.bbox.x + beat.bbox.width / 2,
      clientY: origin.top + beat.bbox.y + beat.bbox.height / 2,
      bubbles: true,
      button: 0,
      pointerId: 1,
    };
    const target = services.playback.getState().position?.position.playbackTick ?? 0;
    canvas.dispatchEvent(new PointerEvent('pointerdown', at));
    canvas.dispatchEvent(new PointerEvent('pointerup', at));
    const where = beatStart(score, beat.id);
    expect(services.fakeAudio.seek).toHaveBeenCalledOnce();
    expect(services.fakeAudio.seek).toHaveBeenLastCalledWith(
      seekTick(timelineOf(score), where, target),
    );
    await frame();
    expect(lineX()).toBeCloseTo(beat.bbox.x + beat.bbox.width / 2 - 1, 3);
  }, 30_000);
});
