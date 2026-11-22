import { write } from '@reprise/formats';
import type { Score } from '@reprise/model';
import { describe, expect, it, vi } from 'vitest';

import { FOLLOW_PLAYHEAD_SETTING } from '@/state/app-settings';
import { playheadAt, type FollowPolicy, type PlaybackCursor } from '@/features/score';
import type { FrameScheduler } from '@/state/position-reader';
import { timelineOf } from '@/state/timeline';
import { positionEventAt, repeatSong } from '@/test/position';
import { createTestServices } from '@/test/services';

import { createAppRegistry } from './app-registry';
import { heardPosition, startPlayhead } from './playhead-driver';

function manualFrames() {
  const pending = new Map<number, () => void>();
  let next = 0;
  const frames: FrameScheduler = {
    request: (callback) => {
      next += 1;
      pending.set(next, callback);
      return next;
    },
    cancel: (handle) => {
      pending.delete(handle);
    },
  };
  const fire = () => {
    const due = [...pending.values()];
    pending.clear();
    for (const callback of due) callback();
  };
  return { frames, fire };
}

async function setup(latency = 0) {
  const services = createTestServices();
  services.fakeAudio.outputLatency.mockReturnValue(latency);
  const song = repeatSong();
  await services.document
    .getState()
    .openBytes('song.reprise', (await write(song, 'reprise')).bytes);
  const score = services.document.getState().score;
  if (!score) throw new Error('no score');
  const view = {
    setPlayhead: vi.fn<(cursor: PlaybackCursor | undefined) => void>(),
    followPlayhead: vi.fn<(policy: FollowPolicy) => void>(),
  };
  const { frames, fire } = manualFrames();
  const clock = { now: 0 };
  const driver = startPlayhead({ services, view: () => view, frames, now: () => clock.now });
  const at = (
    tick: number,
    transport = services.playback.getState().transport,
    countingIn = false,
  ) => {
    services.playback.setState({ position: positionEventAt(score, tick, countingIn), transport });
  };
  /** One frame `seconds` of real time later, the engine at `tick`. */
  const frame = (seconds: number, tick: number) => {
    clock.now += seconds;
    at(tick, 'playing');
    fire();
  };
  const drawn = () => {
    const [cursor] = view.setPlayhead.mock.lastCall ?? [];
    return cursor?.bar.id;
  };
  return { services, score, view, fire, driver, at, frame, drawn };
}

const BAR = 3840;
/** Playback ticks per real second at 120 BPM and 100%. */
const TICKS_PER_SECOND = 1920;

const flush = () =>
  new Promise<void>((resolve) => {
    queueMicrotask(resolve);
  });

describe('the playhead driver', () => {
  it('moves the playhead on a position change while stopped, without following', async () => {
    const { services, score, view, at } = await setup();
    at(3840 + 40);
    const result = services.layout.getState().result;
    if (!result) throw new Error('no layout');
    const expected = playheadAt(result, score, score.masterBars[1]?.id ?? '', 40);
    const [cursor] = view.setPlayhead.mock.lastCall ?? [];
    expect(cursor?.bar).toBe(expected?.bar);
    expect(cursor?.x).toBeCloseTo(expected?.x ?? Number.NaN, 6);
    expect(view.followPlayhead).not.toHaveBeenCalled();
  });

  it('follows once on a request while stopped, and every frame while playing', async () => {
    const { services, view, fire, at } = await setup();
    services.ui.getState().requestFollow();
    at(500);
    expect(view.followPlayhead).toHaveBeenCalledOnce();
    expect(view.followPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'paged', running: false, force: true }),
    );
    await flush();
    expect(view.followPlayhead).toHaveBeenCalledOnce();

    at(600, 'playing');
    fire();
    expect(view.followPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({ running: true, force: true }),
    );
    at(700);
    fire();
    expect(view.followPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({ running: true, force: false }),
    );
  });

  it('stops following on a pause, and resumes on stop; continuous mode is passed on', async () => {
    const { services, view, fire, at } = await setup();
    at(100, 'playing');
    fire();
    const calls = view.followPlayhead.mock.calls.length;
    services.ui.getState().pauseFollow();
    at(200);
    fire();
    expect(view.followPlayhead).toHaveBeenCalledTimes(calls);

    services.ui.getState().setViewMode('continuous');
    at(0, 'stopped');
    await flush();
    expect(services.ui.getState().follow.on).toBe(true);
    expect(view.followPlayhead).toHaveBeenLastCalledWith(
      expect.objectContaining({ mode: 'continuous', running: false }),
    );
  });

  it('a request with no position change follows from the last position', async () => {
    const { services, view, at } = await setup();
    at(100);
    services.ui.getState().requestFollow();
    expect(view.followPlayhead).not.toHaveBeenCalled();
    await flush();
    expect(view.followPlayhead).toHaveBeenCalledOnce();
  });

  it('repaints after a re-layout without following, and hides with no document', async () => {
    const { services, view, driver, at } = await setup();
    at(100, 'playing');
    view.setPlayhead.mockClear();
    view.followPlayhead.mockClear();
    driver.repaint();
    expect(view.setPlayhead).toHaveBeenCalledOnce();
    expect(view.followPlayhead).not.toHaveBeenCalled();

    services.ui.getState().pauseFollow();
    services.document.getState().close();
    expect(services.ui.getState().follow.on).toBe(true);
    driver.repaint();
    expect(view.setPlayhead).toHaveBeenLastCalledWith(undefined);
    driver.stop();
  });
});

describe('the follow playhead setting', () => {
  it('off, play, stop and a running playhead never scroll, but an explicit request does once', async () => {
    const { services, view, fire, at, frame } = await setup();
    services.settings.set(FOLLOW_PLAYHEAD_SETTING, false);

    frame(0.1, 100);
    frame(0.1, 300);
    at(0, 'stopped');
    fire();
    await flush();
    expect(view.followPlayhead).not.toHaveBeenCalled();

    services.ui.getState().requestFollow();
    await flush();
    expect(view.followPlayhead).toHaveBeenCalledOnce();
    expect(view.followPlayhead).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
  });

  it('turning it on mid-run resumes following', async () => {
    const { services, view, frame } = await setup();
    services.settings.set(FOLLOW_PLAYHEAD_SETTING, false);
    frame(0.1, 100);
    expect(view.followPlayhead).not.toHaveBeenCalled();

    services.settings.set(FOLLOW_PLAYHEAD_SETTING, true);
    frame(0.1, 300);
    expect(view.followPlayhead).toHaveBeenCalledOnce();
  });

  it('a real seek still scrolls once while off', async () => {
    const { services, view, at } = await setup();
    services.settings.set(FOLLOW_PLAYHEAD_SETTING, false);
    at(100);

    void createAppRegistry(services).get('transport.nextBar')?.run();
    await flush();

    expect(services.fakeAudio.seek).toHaveBeenCalled();
    expect(view.followPlayhead).toHaveBeenCalledOnce();
    expect(view.followPlayhead).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }));
  });

  it('a panel open, resize and close never scroll while off, stopped or running', async () => {
    const { services, view, fire, at, frame } = await setup();
    const { ui } = services;
    services.settings.set(FOLLOW_PLAYHEAD_SETTING, false);
    at(100);

    ui.getState().setBottomPanelOpen(true);
    ui.getState().setBottomPanelHeight(300);
    await flush();
    expect(view.followPlayhead).not.toHaveBeenCalled();

    frame(0.1, 200);
    ui.getState().setBottomPanelHeight(240);
    ui.getState().setBottomPanelOpen(false);
    fire();
    expect(view.followPlayhead).not.toHaveBeenCalled();
  });

  it('a panel resize still follows while on', async () => {
    const { services, view, at } = await setup();
    at(100);
    services.ui.getState().setBottomPanelOpen(true);
    await flush();
    expect(view.followPlayhead).toHaveBeenCalledOnce();
  });

  it('switching document never scrolls while off', async () => {
    const { services, view } = await setup();
    services.settings.set(FOLLOW_PLAYHEAD_SETTING, false);

    await services.document
      .getState()
      .openBytes('other.reprise', (await write(repeatSong(), 'reprise')).bytes);
    await flush();

    expect(view.followPlayhead).not.toHaveBeenCalled();
  });
});

describe('output latency', () => {
  it('puts the playhead where the music is heard while running, scaled by the speed', () => {
    const song: Score = repeatSong();
    const timeline = timelineOf(song);
    const event = positionEventAt(song, 2000);
    const tempo = { mode: 'percent' as const, value: 100 };
    const bar1 = song.masterBars[0]?.id;
    // 2000 ticks at 120 is 1.0417 s; 0.25 s earlier is 1520 ticks.
    expect(heardPosition(timeline, event, 0.25, tempo, true)).toEqual({
      masterBarId: bar1,
      tick: expect.closeTo(1520, 6) as number,
      playbackTick: expect.closeTo(1520, 6) as number,
    });
    // At half speed a quarter of a second of output is an eighth of a written second.
    expect(heardPosition(timeline, event, 0.25, { ...tempo, value: 50 }, true).tick).toBeCloseTo(
      1760,
      6,
    );
    // A fixed tempo of 60 BPM against the written 120 is half speed too: the written tempo at the
    // playhead is the reference, not the BPM the map was scaled to.
    expect(heardPosition(timeline, event, 0.25, { mode: 'bpm', value: 60 }, true).tick).toBeCloseTo(
      1760,
      6,
    );
    expect(heardPosition(timeline, event, 0.25, tempo, false).tick).toBeCloseTo(2000, 6);
    // Never before the start of the run.
    expect(heardPosition(timeline, event, 0.25, tempo, true, event.seconds - 0.1).tick).toBeCloseTo(
      2000 - 0.1 * TICKS_PER_SECOND,
      6,
    );
  });

  for (const latency of [0.2, 0.024]) {
    describe(`at ${String(latency)} s`, () => {
      it('starts Play on the bar it was started from, then lags by the latency', async () => {
        const { services, score, view, at, frame, drawn } = await setup(latency);
        const bar2 = score.masterBars[1]?.id;
        at(BAR);
        expect(drawn()).toBe(bar2);
        frame(1 / 60, BAR + TICKS_PER_SECOND / 60);
        expect(drawn()).toBe(bar2);
        expect(view.followPlayhead).toHaveBeenLastCalledWith(
          expect.objectContaining({ running: true, force: true }),
        );
        // Every frame until the latency has passed stays on the run's start.
        let tick = BAR + TICKS_PER_SECOND / 60;
        for (let i = 0; i < 20; i++) {
          tick += TICKS_PER_SECOND / 60;
          frame(1 / 60, tick);
          expect(drawn()).toBe(bar2);
        }
        const result = services.layout.getState().result;
        if (!result) throw new Error('no layout');
        const [cursor] = view.setPlayhead.mock.lastCall ?? [];
        const lagged = playheadAt(
          result,
          score,
          bar2 ?? '',
          tick - BAR - latency * TICKS_PER_SECOND,
        );
        expect(cursor?.x).toBeCloseTo(lagged?.x ?? Number.NaN, 6);
        // What it drew is what clicks and steps decide from.
        expect(services.heard.current?.playbackTick).toBeCloseTo(
          tick - latency * TICKS_PER_SECOND,
          6,
        );
      });

      it('shows a seek’s target at once, not the bar before it in playback order', async () => {
        const { score, at, frame, drawn } = await setup(latency);
        at(500, 'playing');
        frame(1 / 60, 520);
        frame(1 / 60, 540);
        // Bar 3 comes after bar 2's second time through; a forward seek must not show it.
        frame(1 / 60, 4 * BAR);
        expect(drawn()).toBe(score.masterBars[2]?.id);
        frame(1 / 60, 4 * BAR + 40);
        expect(drawn()).toBe(score.masterBars[2]?.id);
        // Back to bar 1's second time, which follows bar 2: a backward seek, like a loop wrap.
        frame(1 / 60, 2 * BAR);
        expect(drawn()).toBe(score.masterBars[0]?.id);
      });

      it('starts after a count-in on the bar it counted into', async () => {
        const { score, at, fire, frame, drawn } = await setup(latency);
        at(2 * BAR, 'counting-in', true);
        fire();
        expect(drawn()).toBe(score.masterBars[0]?.id);
        frame(1 / 60, 2 * BAR + 30);
        expect(drawn()).toBe(score.masterBars[0]?.id);
      });
    });
  }
});
