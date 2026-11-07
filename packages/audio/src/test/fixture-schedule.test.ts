import { describe, expect, inject, it } from 'vitest';

import { beatStartTicks, parseNative, secondsAt } from '@reprise/model';

import { advance, startRun } from '../scheduler';
import type { ScheduledNote } from '../scheduler';
import { clicksInRange, createTimeline } from '../timeline';
import type { Timeline } from '../timeline';

const fixtures = inject('scoreFixtures');

/** alphaTab 1.8.4's note-on ticks for `notes.gp3` and `notes.gp4`, one 4/4 bar of 35 beats. */
const NOTES_ONSETS = [
  0, 3840, 7680, 11520, 19200, 21120, 23040, 24960, 28800, 29760, 30720, 31680, 33600, 34080, 34560,
  35040, 36000, 36240, 36480, 36720, 37200, 37320, 37440, 37560, 37800, 37860, 37920, 37980,
];

/** Walks `advance` the way the 25 ms timer does, from the start to the end of the song. */
function scheduleAll(timeline: Timeline): ScheduledNote[] {
  const notes: ScheduledNote[] = [];
  let run = startRun(timeline, { tick: 0, time: 0, rate: 1, loop: undefined, countIn: false });
  for (let now = 0; !run.finished; now += 0.025) {
    for (;;) {
      const result = advance(timeline, run, { now, horizon: now + 0.2, metronome: false });
      run = result.run;
      notes.push(...result.notes);
      if (!result.loop) break;
    }
  }
  return notes;
}

function timelineOf(path: string): Timeline {
  const fixture = fixtures.find((f) => f.path === path);
  if (!fixture) throw new Error(`${path} is not in the corpus`);
  return createTimeline(parseNative(new TextEncoder().encode(fixture.native)).score);
}

describe('scheduling the fixture corpus', () => {
  for (const fixture of fixtures) {
    it(`${fixture.path} schedules every untied note once, at its beat start`, () => {
      const timeline = timelineOf(fixture.path);
      const { map } = timeline;
      const scheduled = new Map<string, number[]>();
      for (const n of scheduleAll(timeline)) {
        const key = `${String(n.sequenceIndex)}:${n.note.id}`;
        scheduled.set(key, [...(scheduled.get(key) ?? []), n.when]);
      }
      const failures: string[] = [];
      for (const [sequenceIndex, pass] of map.passes.entries()) {
        for (const [trackIndex, track] of map.score.tracks.entries()) {
          const voices = track.bars[pass.masterBarIndex]?.voices ?? [];
          for (const [voiceIndex, voice] of voices.entries()) {
            for (const [beatIndex, beat] of voice.beats.entries()) {
              const expected = secondsAt(map, sequenceIndex, beatStartTicks(voice, beatIndex));
              for (const n of beat.notes) {
                if (n.tie) continue;
                const whens = scheduled.get(`${String(sequenceIndex)}:${n.id}`) ?? [];
                const where = `pass ${String(sequenceIndex)} (bar ${String(pass.masterBarIndex + 1)}), track ${String(trackIndex)} voice ${String(voiceIndex)} beat ${String(beatIndex)}`;
                if (whens.length !== 1) {
                  failures.push(`${where}: scheduled ${String(whens.length)} times`);
                } else if (Math.abs((whens[0] ?? 0) - expected) > 1e-6) {
                  failures.push(`${where}: at ${String(whens[0])} s, not ${String(expected)} s`);
                }
              }
            }
          }
        }
      }
      expect(failures).toEqual([]);
    });
  }

  for (const path of ['gp3/notes.gp3', 'gp4/notes.gp4']) {
    it(`${path} plays all 35 beats of its over-full bar at alphaTab's onsets`, () => {
      const timeline = timelineOf(path);
      expect(timeline.endTick).toBe(38100);
      expect(scheduleAll(timeline).map((n) => n.tick)).toEqual(NOTES_ONSETS);
    });
  }

  for (const path of ['gp3/effects.gp3', 'gp4/effects.gp4', 'gp5/effects.gp5', 'gpx/effects.gpx']) {
    it(`${path} plays all ten quarters of bar 24 before bar 25 starts`, () => {
      const timeline = timelineOf(path);
      const bar24 = timeline.map.passes[23];
      expect(bar24).toMatchObject({ masterBarIndex: 23, startTick: 90240, ticks: 9600 });
      const onsets = scheduleAll(timeline)
        .filter((n) => n.sequenceIndex === 23)
        .map((n) => n.tick - 90240);
      expect([...new Set(onsets)]).toEqual(Array.from({ length: 10 }, (_, i) => i * 960));
      expect(timeline.map.passes[24]?.startTick).toBe(99840);
      expect(timeline.map.durationSeconds).toBe(68);
    });
  }

  it('gp/multivoice-rhythm.gp clicks no flam before the downbeat after its over-full bar 2', () => {
    const timeline = timelineOf('gp/multivoice-rhythm.gp');
    const bar2 = timeline.map.passes[1];
    expect(bar2).toMatchObject({ masterBarIndex: 1, ticks: 3960 });
    const start = bar2?.startTick ?? 0;
    const clicks = clicksInRange(timeline, start, start + 3960 + 1);
    expect(clicks.map((c) => [c.tick - start, c.accent])).toEqual([
      [0, true],
      [960, false],
      [1920, false],
      [2880, false],
      [3960, true],
    ]);
  });
});
