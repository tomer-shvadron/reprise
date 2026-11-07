/**
 * Playback order and tempo against alphaTab's MIDI generator, the oracle the model README's
 * "Deviations from alphaTab" table is written against. Each row of that table is a detector, so
 * a divergence it explains is reported as explained rather than failed.
 */
import * as alphaTab from '@coderline/alphatab';
import { PLAYBACK_LENGTH_FACTOR, beatStartTicks, beatTicks, tempoMap } from '@reprise/model';
import type { BarPass, PlaybackWarning, Score } from '@reprise/model';

import type { CheckExplained, CheckViolation } from './check-meta';

export interface AlphaTabPass {
  masterBarIndex: number;
  start: number;
  end: number;
  /** Absolute ticks, as the generator's tick lookup holds them. */
  tempoChanges: { tick: number; tempo: number }[];
}

export interface AlphaTabPlayback {
  passes: AlphaTabPass[];
  /** The generator was stopped after `PLAYBACK_LENGTH_FACTOR` passes per master bar. */
  guardFired: boolean;
}

class LoopGuard extends Error {}

const ignore = (): void => undefined;

/** A handler that records nothing; only the tick lookup is read. */
const SILENT_HANDLER: alphaTab.midi.IMidiFileHandler = {
  addTimeSignature: ignore,
  addRest: ignore,
  addNote: ignore,
  addControlChange: ignore,
  addProgramChange: ignore,
  addTempo: ignore,
  addNoteBend: ignore,
  addBend: ignore,
  finishTrack: ignore,
  addTickShift: ignore,
};

interface TickLookupLike<T> {
  addMasterBar: (bar: T) => void;
}

/**
 * Wraps `addMasterBar` so a generator that loops (alphaTab has no guard; a D.S. after a coda
 * loops there) stops after `limit` passes.
 */
export function guardTickLookup<T>(lookup: TickLookupLike<T>, limit: number): void {
  const add = lookup.addMasterBar.bind(lookup);
  let calls = 0;
  lookup.addMasterBar = (bar) => {
    calls += 1;
    if (calls > limit) throw new LoopGuard(`more than ${String(limit)} passes`);
    add(bar);
  };
}

export function alphaTabPlayback(score: alphaTab.model.Score): AlphaTabPlayback {
  const generator = new alphaTab.midi.MidiFileGenerator(
    score,
    new alphaTab.Settings(),
    SILENT_HANDLER,
  );
  guardTickLookup(generator.tickLookup, score.masterBars.length * PLAYBACK_LENGTH_FACTOR);
  let guardFired = false;
  try {
    generator.generate();
  } catch (error) {
    if (!(error instanceof LoopGuard)) throw error;
    guardFired = true;
  }
  return {
    guardFired,
    passes: generator.tickLookup.masterBars.map((bar) => ({
      masterBarIndex: bar.masterBar.index,
      start: bar.start,
      end: bar.end,
      tempoChanges: bar.tempoChanges.map(({ tick, tempo }) => ({ tick, tempo })),
    })),
  };
}

/** Run-length ranges of 1-based bars, broken at every backward jump: `1–8, 1–7, 9, 10–16`. */
export function runLength(bars: readonly number[]): string {
  const runs: string[] = [];
  let start: number | undefined;
  let last: number | undefined;
  const flush = (): void => {
    if (start === undefined || last === undefined) return;
    runs.push(start === last ? String(start + 1) : `${String(start + 1)}–${String(last + 1)}`);
  };
  for (const bar of bars) {
    if (last !== undefined && bar === last + 1) {
      last = bar;
      continue;
    }
    flush();
    start = bar;
    last = bar;
  }
  flush();
  return runs.join(', ');
}

const RETURN_JUMPS = new Set([
  'daCapo',
  'dcAlCoda',
  'dcAlDoubleCoda',
  'dcAlFine',
  'dalSegno',
  'dsAlCoda',
  'dsAlDoubleCoda',
  'dsAlFine',
  'dalSegnoSegno',
  'dssAlCoda',
  'dssAlDoubleCoda',
  'dssAlFine',
]);

export type DetectorId =
  | 'return-jump-on-repeat-end'
  | 'voltas-after-return-jump'
  | 'jump-on-volta'
  | 'nested-repeat-start'
  | 'several-repeat-ends-with-voltas'
  | 'unmatched-end-after-coda';

const hasReturnJump = (bar: Score['masterBars'][number]): boolean =>
  bar.jumps.some((jump) => RETURN_JUMPS.has(jump.kind));

/** One detector per row of the model README's "Deviations from alphaTab" that touches order. */
export function detectDeviations(
  score: Score,
  warnings: readonly PlaybackWarning[],
): Map<DetectorId, number[]> {
  const bars = score.masterBars;
  const found = new Map<DetectorId, number[]>();
  const flag = (id: DetectorId, index: number): void => {
    found.set(id, [...(found.get(id) ?? []), index]);
  };
  bars.forEach((bar, i) => {
    if (hasReturnJump(bar) && bar.repeat.endCount >= 2) flag('return-jump-on-repeat-end', i);
    if (bar.jumps.length > 0 && bar.alternateEndings.length > 0) flag('jump-on-volta', i);
  });
  const firstReturn = bars.findIndex(hasReturnJump);
  if (firstReturn >= 0 && bars.some((bar) => bar.alternateEndings.length > 0)) {
    flag('voltas-after-return-jump', firstReturn);
  }
  let openStart: number | undefined;
  bars.forEach((bar, i) => {
    if (bar.repeat.start) {
      const closes = bars.slice(i + 1).some((later) => later.repeat.endCount > 0);
      if (openStart !== undefined && closes) flag('nested-repeat-start', i);
      openStart = i;
    }
    if (bar.repeat.endCount > 0) openStart = undefined;
  });
  const starts = bars.flatMap((bar, i) => (bar.repeat.start || i === 0 ? [i] : []));
  starts.forEach((start, k) => {
    const section = bars.slice(start, starts[k + 1] ?? bars.length);
    const ends = section.filter((bar) => bar.repeat.endCount > 0).length;
    if (ends >= 2 && section.some((bar) => bar.alternateEndings.length > 0)) {
      flag('several-repeat-ends-with-voltas', start);
    }
  });
  const coda = bars.findIndex(
    (bar) => bar.targets.includes('coda') || bar.targets.includes('doubleCoda'),
  );
  if (coda >= 0) {
    for (const warning of warnings) {
      if (warning.code === 'repeat-end-without-start' && warning.masterBarIndex > coda) {
        flag('unmatched-end-after-coda', warning.masterBarIndex);
      }
    }
  }
  return found;
}

export interface OrderComparison {
  identical: boolean;
  violations: CheckViolation[];
  explained: CheckExplained[];
  firstDivergence?: number;
}

export function compareOrder(
  ours: readonly number[],
  theirs: AlphaTabPlayback,
  deviations: ReadonlyMap<DetectorId, number[]>,
  masterBarCount: { ours: number; alphaTab: number },
): OrderComparison {
  if (masterBarCount.ours !== masterBarCount.alphaTab) {
    return {
      identical: false,
      explained: [],
      violations: [
        {
          code: 'master-bar-count',
          message: `we read ${String(masterBarCount.ours)} master bars, alphaTab ${String(masterBarCount.alphaTab)}`,
        },
      ],
    };
  }
  const alphaTabOrder = theirs.passes.map((pass) => pass.masterBarIndex);
  const length = Math.max(ours.length, alphaTabOrder.length);
  let divergence: number | undefined;
  for (let i = 0; i < length; i += 1) {
    if (ours[i] !== alphaTabOrder[i]) {
      divergence = i;
      break;
    }
  }
  if (divergence === undefined) return { identical: true, violations: [], explained: [] };
  if (theirs.guardFired) {
    return {
      identical: false,
      firstDivergence: divergence,
      violations: [],
      explained: [
        {
          id: 'jump-fires-once',
          message: 'alphaTab loops on a jump; ours fires each once',
          count: 1,
        },
      ],
    };
  }
  const seen = new Set([
    ...ours.slice(0, divergence + 1),
    ...alphaTabOrder.slice(0, divergence + 1),
  ]);
  const explained: CheckExplained[] = [];
  for (const [id, bars] of deviations) {
    const hits = bars.filter((bar) => seen.has(bar));
    if (hits.length > 0) {
      explained.push({
        id,
        message: `a documented deviation from alphaTab at bar ${hits.map((bar) => String(bar + 1)).join(', ')}`,
        count: hits.length,
      });
    }
  }
  if (explained.length > 0) {
    return { identical: false, firstDivergence: divergence, violations: [], explained };
  }
  const oursBar = ours[divergence];
  const theirsBar = alphaTabOrder[divergence];
  const label = (bar: number | undefined): string =>
    bar === undefined ? 'end' : `bar ${String(bar + 1)}`;
  return {
    identical: false,
    firstDivergence: divergence,
    explained: [],
    violations: [
      {
        code: 'order-differs',
        message: `the play order leaves alphaTab's at pass ${String(divergence + 1)}`,
        where: `pass ${String(divergence + 1)}: ours ${label(oursBar)}, alphaTab ${label(theirsBar)}`,
        data: {
          firstDivergence: divergence + 1,
          oursPasses: ours.length,
          alphaTabPasses: alphaTabOrder.length,
        },
      },
    ],
  };
}

interface TempoEvent {
  tick: number;
  bpm: number;
}

interface OurEvent extends TempoEvent {
  ramp?: boolean;
  endTick?: number;
}

const TICK_TOLERANCE = 2;
const BPM_TOLERANCE = 0.01;
const SECONDS_TOLERANCE = 0.001;
const MAX_TEMPO_VIOLATIONS = 20;

const sameEvents = (a: readonly TempoEvent[], b: readonly TempoEvent[]): boolean =>
  a.length === b.length &&
  a.every((event, i) => {
    const other = b[i];
    return (
      other !== undefined &&
      Math.abs(event.tick - other.tick) <= TICK_TOLERANCE &&
      Math.abs(event.bpm - other.bpm) <= BPM_TOLERANCE
    );
  });

const eventString = (events: readonly TempoEvent[]): string =>
  events.map(({ tick, bpm }) => `${String(Math.round(tick))}@${String(bpm)}`).join(' ') || 'none';

/** alphaTab's changes in one pass relative to its start, without repeats of the tempo in effect. */
function alphaTabEvents(
  pass: AlphaTabPass,
  running: number,
): { events: TempoEvent[]; end: number } {
  const events: TempoEvent[] = [];
  let bpm = running;
  for (const change of pass.tempoChanges) {
    if (Math.abs(change.tempo - bpm) <= BPM_TOLERANCE) continue;
    events.push({ tick: change.tick - pass.start, bpm: change.tempo });
    bpm = change.tempo;
  }
  return { events, end: bpm };
}

function alphaTabSeconds(pass: AlphaTabPass, running: number): number {
  let seconds = 0;
  let tick = pass.start;
  let bpm = running;
  for (const change of pass.tempoChanges) {
    seconds += ((change.tick - tick) * 60) / (960 * bpm);
    tick = change.tick;
    bpm = change.tempo;
  }
  return seconds + ((pass.end - tick) * 60) / (960 * bpm);
}

/** Whether alphaTab's tick lies strictly inside a beat of the bar that starts at our tick. */
function insideBeatStartingAt(
  score: Score,
  masterBarIndex: number,
  ours: number,
  theirs: number,
): boolean {
  for (const track of score.tracks) {
    for (const voice of track.bars[masterBarIndex]?.voices ?? []) {
      for (let b = 0; b < voice.beats.length; b += 1) {
        const beat = voice.beats[b];
        if (!beat) continue;
        const start = beatStartTicks(voice, b);
        if (
          Math.abs(start - ours) <= TICK_TOLERANCE &&
          theirs > start &&
          theirs < start + beatTicks(beat)
        ) {
          return true;
        }
      }
    }
  }
  return false;
}

export interface TempoComparison {
  violations: CheckViolation[];
  explained: CheckExplained[];
  oursSeconds: number;
  alphaTabSeconds: number;
}

export function compareTempo(
  score: Score,
  sequence: readonly BarPass[],
  theirs: AlphaTabPlayback,
  tempoMoved: boolean,
): TempoComparison {
  const map = tempoMap(score, sequence);
  const violations: CheckViolation[] = [];
  const counts = new Map<string, { message: string; count: number }>();
  const explain = (id: string, message: string): void => {
    const entry = counts.get(id) ?? { message, count: 0 };
    entry.count += 1;
    counts.set(id, entry);
  };
  let oursRunning = 120;
  let theirsRunning = 120;
  let totalTheirs = 0;
  let rampOpen = false;
  map.passes.forEach((pass, p) => {
    const at = theirs.passes[p];
    if (!at) return;
    const where = `bar ${String(pass.masterBarIndex + 1)} (pass ${String(p + 1)})`;
    const theirLength = at.end - at.start;
    if (Math.abs(theirLength - pass.ticks) > TICK_TOLERANCE) {
      const anacrusis = score.masterBars[pass.masterBarIndex]?.anacrusis === true;
      if (anacrusis && theirLength > pass.ticks) {
        explain(
          'anacrusis-capped',
          'an anacrusis lasts its longest voice, capped at the written length',
        );
      } else if (violations.length < MAX_TEMPO_VIOLATIONS) {
        violations.push({
          code: 'pass-length',
          message: `the pass lasts ${String(pass.ticks)} ticks, alphaTab ${String(theirLength)}`,
          where,
        });
      }
    }
    const ours: OurEvent[] = [];
    let ramped = false;
    for (const segment of pass.segments) {
      const ramp = Math.abs(segment.endBpm - segment.startBpm) > 1e-9;
      const continued = rampOpen && segment.tick === 0;
      rampOpen = ramp;
      if (ramp && continued) {
        // A ramp carried over the bar line: alphaTab stepped to its target in the earlier pass.
        ramped = true;
        oursRunning = segment.endBpm;
      } else if (ramp) {
        ramped = true;
        const previous = ours.at(-1);
        // Consecutive ramp segments are one ramp: alphaTab steps once, to its target.
        if (previous && previous.ramp === true && previous.endTick === segment.tick) {
          previous.bpm = segment.endBpm;
          previous.endTick = segment.tick + segment.ticks;
        } else {
          ours.push({
            tick: segment.tick,
            bpm: segment.endBpm,
            ramp: true,
            endTick: segment.tick + segment.ticks,
          });
        }
        oursRunning = segment.endBpm;
      } else if (Math.abs(segment.startBpm - oursRunning) > BPM_TOLERANCE) {
        ours.push({ tick: segment.tick, bpm: segment.startBpm });
        oursRunning = segment.startBpm;
      }
    }
    const theirSeconds = alphaTabSeconds(at, theirsRunning);
    totalTheirs += theirSeconds;
    const { events: alphaTabChanges, end } = alphaTabEvents(at, theirsRunning);
    theirsRunning = end;
    const oursEvents = ours.map(({ tick, bpm }) => ({ tick, bpm }));
    const equal = sameEvents(oursEvents, alphaTabChanges);
    if (equal && Math.abs(theirSeconds - pass.durationSeconds) <= SECONDS_TOLERANCE) return;
    if (equal && ramped) {
      explain(
        'tempo-ramp',
        'a tempo ramp: ours glides, alphaTab steps at the beat (isLinear is ignored)',
      );
      return;
    }
    const moved =
      tempoMoved &&
      oursEvents.length === alphaTabChanges.length &&
      oursEvents.every((event, i) => {
        const other = alphaTabChanges[i];
        if (!other || Math.abs(event.bpm - other.bpm) > BPM_TOLERANCE) return false;
        return (
          Math.abs(event.tick - other.tick) <= TICK_TOLERANCE ||
          insideBeatStartingAt(score, pass.masterBarIndex, event.tick, other.tick)
        );
      });
    if (moved) {
      explain(
        'tempo-moved',
        'a mid-beat tempo change, moved to the start of its beat by the reader',
      );
      return;
    }
    if (violations.length < MAX_TEMPO_VIOLATIONS) {
      violations.push({
        code: 'tempo-differs',
        message: `the tempo changes in this pass differ from alphaTab's`,
        where,
        data: { ours: eventString(oursEvents), alphaTab: eventString(alphaTabChanges) },
      });
    }
  });
  return {
    violations,
    explained: [...counts.entries()].map(([id, { message, count }]) => ({ id, message, count })),
    oursSeconds: map.durationSeconds,
    alphaTabSeconds: totalTheirs,
  };
}
