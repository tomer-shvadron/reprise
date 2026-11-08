import {
  PPQ,
  barTicks,
  beatStartTicks,
  type NativePath,
  type Score,
  type TempoMark,
} from '@reprise/model';

import { automationBarStarts } from './automation-bars';
import type { DropCollector } from './dropped';

/** Ticks closer than this are one moment, as the reader's own tolerance has it. */
const TICK_TOLERANCE = 0.5;

/** One `MasterTrack/Automations/Automation` of type `Tempo`. */
export interface TempoAutomation {
  bar: number;
  /** A ratio of the bar's written length; 1 or more on an over-full bar's overflow. */
  position: number;
  mark: TempoMark;
  /** gpif's `Linear`: the tempo ramps from the previous automation into this one. */
  linear: boolean;
}

interface TempoEvent {
  tick: number;
  mark: TempoMark;
  /** Quarter notes; 0 for a step. */
  ramp: number;
  path: NativePath;
}

const sameMark = (a: TempoMark, b: TempoMark): boolean =>
  a.bpm === b.bpm && a.unit === b.unit && a.label === b.label;

function markOf(tempo: TempoMark): TempoMark {
  const mark: TempoMark = { bpm: tempo.bpm };
  if (tempo.unit !== undefined) mark.unit = tempo.unit;
  if (tempo.label !== undefined) mark.label = tempo.label;
  return mark;
}

/**
 * Every tick the reader can put a mark on: bar starts (a bar's own tempo) and the start of some
 * beat of some track.
 */
function beatStartSet(score: Score, starts: number[]): number[] {
  const ticks = new Set<number>(starts);
  for (const track of score.tracks) {
    track.bars.forEach((bar, index) => {
      const start = starts[index] ?? 0;
      for (const voice of bar.voices) {
        for (let beat = 0; beat < voice.beats.length; beat++) {
          ticks.add(start + beatStartTicks(voice, beat));
        }
      }
    });
  }
  return [...ticks].sort((a, b) => a - b);
}

function isBeatStart(sorted: number[], tick: number): boolean {
  let low = 0;
  let high = sorted.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const value = sorted[middle] ?? 0;
    if (Math.abs(value - tick) <= TICK_TOLERANCE) return true;
    if (value < tick) low = middle + 1;
    else high = middle - 1;
  }
  return false;
}

/**
 * Tempo marks and beat tempo changes in written order, one per moment. Where tracks or voices
 * disagree at one moment the first wins, as playback has it; a beat's step at a bar start
 * replaces the bar's mark, since playback applies it after the mark.
 */
function collectEvents(score: Score, starts: number[], drops: DropCollector): TempoEvent[] {
  const byTick = new Map<number, TempoEvent[]>();
  const key = (tick: number): number => Math.round(tick * 1000);
  score.masterBars.forEach((masterBar, index) => {
    if (masterBar.tempo) {
      const tick = starts[index] ?? 0;
      byTick.set(key(tick), [
        { tick, mark: markOf(masterBar.tempo), ramp: 0, path: ['masterBars', index, 'tempo'] },
      ]);
    }
  });
  score.tracks.forEach((track, trackIndex) => {
    track.bars.forEach((bar, barIndex) => {
      bar.voices.forEach((voice, voiceIndex) => {
        voice.beats.forEach((beat, beatIndex) => {
          const tempo = beat.mix?.tempo;
          if (!tempo) return;
          const tick = (starts[barIndex] ?? 0) + beatStartTicks(voice, beatIndex);
          const path: NativePath = [
            'tracks',
            trackIndex,
            'bars',
            barIndex,
            'voices',
            voiceIndex,
            'beats',
            beatIndex,
            'mix',
            'tempo',
          ];
          const event: TempoEvent = { tick, mark: markOf(tempo), ramp: tempo.duration ?? 0, path };
          const existing = byTick.get(key(tick)) ?? [];
          const fromBeat = existing.find((other) => other.path[0] === 'tracks');
          if (fromBeat) {
            if (!sameMark(fromBeat.mark, event.mark) || fromBeat.ramp !== event.ramp) {
              drops.drop(
                'tempo-collision',
                path,
                'Two tempo changes at one moment; the first track and voice wins, as in playback',
              );
            }
            return;
          }
          const barMark = existing[0];
          if (barMark && event.ramp === 0) {
            if (!sameMark(barMark.mark, event.mark)) {
              drops.drop(
                'tempo-collision',
                path,
                "A beat's tempo change at its bar's start replaces the bar's tempo mark",
              );
            }
            byTick.set(key(tick), [event]);
            return;
          }
          byTick.set(key(tick), [...existing, event]);
        });
      });
    });
  });
  return [...byTick.values()].flat().sort((a, b) => a.tick - b.tick);
}

/**
 * The model's tempo marks as gpif tempo automations. A step is one automation at its moment. A
 * ramp (`Beat.mix.tempo.duration`) becomes the pair gpif uses: an automation at the ramp's start
 * holding the tempo in effect, and a linear one `duration` quarter notes later holding the
 * target; the reader turns that pair back into the ramp, and the target into a mark at its end.
 * A ramp gpif cannot express (cut short by the next change, ending past the score or between
 * beats, or ending on a different mark) is reported and written as a step to its target. Each
 * automation goes in the bar holding its moment on the automation timeline, so a change on an
 * over-full bar's overflow stays in that bar.
 */
export function planTempos(score: Score, drops: DropCollector): TempoAutomation[] {
  const starts = automationBarStarts(score);
  const end = starts.at(-1) ?? 0;
  const events = collectEvents(score, starts, drops);
  let beatStarts: number[] | undefined;
  const automations = new Map<number, { tick: number; mark: TempoMark; linear: boolean }>();
  const key = (tick: number): number => Math.round(tick * 1000);
  const at = (tick: number) => automations.get(key(tick));
  let current: TempoMark = { bpm: 120 };

  events.forEach((event, index) => {
    if (event.ramp === 0) {
      const existing = at(event.tick);
      // A ramp ending here already holds this mark, marked linear.
      if (!existing) automations.set(key(event.tick), { ...event, linear: false });
      current = event.mark;
      return;
    }
    const target = event.tick + event.ramp * PPQ;
    const next = events.slice(index + 1).find((other) => other.tick > event.tick + TICK_TOLERANCE);
    let problem: string | undefined;
    if (next && next.tick < target - TICK_TOLERANCE) {
      problem = 'A tempo ramp cut short by the next tempo change';
    } else if (target > end - TICK_TOLERANCE) {
      problem = 'A tempo ramp ending at or past the end of the score';
    } else if (next && Math.abs(next.tick - target) <= TICK_TOLERANCE) {
      if (next.ramp === 0 && !sameMark(next.mark, event.mark)) {
        problem = 'A tempo ramp ending on a different tempo mark';
      }
    } else {
      beatStarts ??= beatStartSet(score, starts);
      if (!isBeatStart(beatStarts, target)) {
        problem = 'A tempo ramp ending between beats; it reads back ending on the beat before';
      }
    }
    if (problem !== undefined) {
      drops.drop('tempo-ramp', event.path, `${problem}; written as a step to its tempo`);
      automations.set(key(event.tick), { tick: event.tick, mark: event.mark, linear: false });
      current = event.mark;
      return;
    }
    if (!at(event.tick)) {
      automations.set(key(event.tick), { tick: event.tick, mark: current, linear: false });
    }
    automations.set(key(target), { tick: target, mark: event.mark, linear: true });
    current = event.mark;
  });

  const result: TempoAutomation[] = [];
  let bar = 0;
  for (const automation of [...automations.values()].sort((a, b) => a.tick - b.tick)) {
    while (bar < score.masterBars.length - 1 && (starts[bar + 1] ?? 0) <= automation.tick + 1e-9) {
      bar++;
    }
    const masterBar = score.masterBars[bar];
    const length = masterBar ? barTicks(masterBar) : 1;
    const offset = automation.tick - (starts[bar] ?? 0);
    result.push({
      bar,
      position: Math.abs(offset) <= 1e-9 ? 0 : offset / length,
      mark: automation.mark,
      linear: automation.linear,
    });
  }
  return result;
}
