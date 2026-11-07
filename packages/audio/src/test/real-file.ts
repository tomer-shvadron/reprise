/**
 * What the real-file pass checks in a GM render: that the scheduler handed the sink every note
 * the score holds, at its time, and that each scheduled attack can be heard in the audio.
 */
import {
  beatStartTicks,
  beatTicks,
  expandPlaybackSequence,
  secondsAt,
  tempoMap,
} from '@reprise/model';
import type { Score, Track } from '@reprise/model';

import type { NoteEvent } from '../sink';
import type { CheckViolation } from './check-meta';
import { START } from './harness';
import type { Strike } from './harness';
import { attackRatios, spectralFlux } from './signal';
import type { Signal } from './signal';

const TIMING_TOLERANCE = 0.001;
const FIRST_WHERE = 5;

/** Attack verification: ratios at or above `heard` are heard, below `missed` missed. */
export const ATTACK_THRESHOLDS = {
  heard: 1.5,
  missed: 1.2,
  /** A run fails above this share of missed clusters, at least `minMisses`, at most `maxMisses`… */
  missShare: 0.02,
  minMisses: 2,
  maxMisses: 10,
  /** …or on this many missed clusters in a row. */
  consecutive: 3,
  /** Attacks this close to the first of a cluster merge into it. */
  clusterSeconds: 0.03,
};

const eventKey = (pass: number, track: number, voice: number, beat: number, note: string): string =>
  `${String(pass)}:${String(track)}:${String(voice)}:${String(beat)}:${note}`;

export const keyOf = (event: NoteEvent): string =>
  eventKey(event.sequenceIndex, event.trackIndex, event.voiceIndex, event.beatIndex, event.note.id);

export function describeTrack(track: Track, index: number): string {
  return `track ${String(index + 1)} (${track.kind}, program ${String(track.program)})`;
}

export function audible(score: Score, track: Track): boolean {
  const anySolo = score.tracks.some((candidate) => candidate.channel.solo);
  return !track.channel.mute && (!anySolo || track.channel.solo);
}

interface Expected {
  when: number;
  where: string;
  track: number;
}

export interface Completeness {
  violations: CheckViolation[];
  expected: number;
}

/** Violations folded per code and track, with a count and the first places. */
class PerTrack {
  readonly #groups = new Map<
    string,
    { code: string; track: number; message: string; where: string[]; count: number }
  >();

  add(code: string, track: number, message: string, where: string): void {
    const key = `${code}|${String(track)}`;
    const group = this.#groups.get(key) ?? { code, track, message, where: [], count: 0 };
    group.count += 1;
    if (group.where.length < FIRST_WHERE) group.where.push(where);
    this.#groups.set(key, group);
  }

  list(score: Score): CheckViolation[] {
    return [...this.#groups.values()].map(({ code, track, message, where, count }) => {
      const owner = score.tracks[track];
      const name = owner ? describeTrack(owner, track) : `track ${String(track + 1)}`;
      return {
        code,
        message: `${message} on ${name} (${String(count)}×)`,
        where: where.join('; '),
        data: { track: track + 1, count },
      };
    });
  }
}

/**
 * Every untied note of every pass, from the model alone, against what the sink received. Tied
 * notes may arrive (an origin that did not play just before) but are not required.
 */
export function completeness(score: Score, scheduled: readonly NoteEvent[]): Completeness {
  const { sequence } = expandPlaybackSequence(score);
  const map = tempoMap(score, sequence);
  const expected = new Map<string, Expected>();
  const tied = new Set<string>();
  const folded = new PerTrack();
  sequence.forEach((pass, i) => {
    score.tracks.forEach((track, t) => {
      track.bars[pass.masterBarIndex]?.voices.forEach((voice, v) => {
        voice.beats.forEach((beat, b) => {
          if (beat.rest || beat.notes.length === 0) return;
          const start = beatStartTicks(voice, b);
          const where = `bar ${String(pass.masterBarIndex + 1)} (pass ${String(i + 1)}), ${describeTrack(track, t)}, beat ${String(b + 1)}`;
          for (const note of beat.notes) {
            const key = eventKey(i, t, v, b, note.id);
            if (note.tie) {
              tied.add(key);
            } else {
              expected.set(key, { when: START + secondsAt(map, i, start), where, track: t });
            }
          }
        });
      });
    });
  });
  const seen = new Set<string>();
  for (const event of scheduled) {
    const key = keyOf(event);
    const where = `bar ${String(event.masterBarIndex + 1)} (pass ${String(event.sequenceIndex + 1)}), ${describeTrack(event.track, event.trackIndex)}, beat ${String(event.beatIndex + 1)}`;
    if (seen.has(key)) {
      folded.add('note-scheduled-twice', event.trackIndex, 'notes scheduled twice', where);
      continue;
    }
    seen.add(key);
    const wanted = expected.get(key);
    if (wanted) {
      const off = event.when - wanted.when;
      if (Math.abs(off) > TIMING_TOLERANCE) {
        folded.add(
          'note-mistimed',
          event.trackIndex,
          'notes off their beat by more than 1 ms',
          `${where}, ${(off * 1000).toFixed(1)} ms`,
        );
      }
    } else if (!tied.has(key)) {
      folded.add(
        'note-unexpected',
        event.trackIndex,
        'events that match no note of their pass',
        where,
      );
    }
  }
  for (const [key, wanted] of expected) {
    if (!seen.has(key))
      folded.add(
        'note-not-scheduled',
        wanted.track,
        'notes never handed to the sink',
        wanted.where,
      );
  }
  return { violations: folded.list(score), expected: expected.size };
}

/** True for a note the sampler sink carries on the previous voice instead of striking. */
function carried(event: NoteEvent, previous: NoteEvent | undefined): boolean {
  return (
    event.note.hammerPull ||
    (event.note.string > 0 && previous?.note.slide?.includes('legato') === true)
  );
}

/**
 * The step from the sink to the sampler: every scheduled note on an audible track is struck on
 * its track. A plain note's strike lands on its beat within 1 ms; graces and strokes move strikes
 * on purpose, so a beat with either needs one strike within a beat's length of its onset.
 */
export function strikeTiming(
  score: Score,
  scheduled: readonly NoteEvent[],
  struck: readonly (readonly Strike[])[],
): CheckViolation[] {
  const folded = new PerTrack();
  const lastOnString = new Map<string, NoteEvent>();
  scheduled.forEach((event, i) => {
    const stringKey = `${String(event.trackIndex)}:${String(event.note.string)}`;
    const previous = lastOnString.get(stringKey);
    lastOnString.set(stringKey, event);
    if (!audible(score, event.track) || carried(event, previous)) return;
    const strikes = (struck[i] ?? []).filter((strike) => strike.track === event.track.id);
    const where = `bar ${String(event.masterBarIndex + 1)} (pass ${String(event.sequenceIndex + 1)}), ${describeTrack(event.track, event.trackIndex)}, beat ${String(event.beatIndex + 1)}`;
    if (strikes.length === 0) {
      folded.add(
        'note-not-struck',
        event.trackIndex,
        'scheduled notes the sampler never struck',
        where,
      );
      return;
    }
    const { effects, grace } = event.beat;
    const moved =
      (grace?.length ?? 0) > 0 || effects.brush !== undefined || effects.arpeggio !== undefined;
    const secondsPerTick = event.durationTicks > 0 ? event.duration / event.durationTicks : 0;
    const allowance = moved ? beatTicks(event.beat) * secondsPerTick : TIMING_TOLERANCE;
    const nearest = strikes.reduce((best, strike) =>
      Math.abs(strike.when - event.when) < Math.abs(best.when - event.when) ? strike : best,
    );
    const off = nearest.when - event.when;
    if (Math.abs(off) > allowance) {
      folded.add(
        'strike-late',
        event.trackIndex,
        'notes struck off their scheduled time',
        `${where}, ${(off * 1000).toFixed(1)} ms`,
      );
    }
  });
  return folded.list(score);
}

export interface Cluster {
  when: number;
  event: NoteEvent;
}

/**
 * The attacks a listener should hear: scheduled notes on audible tracks, without hammer-on and
 * pull-off destinations and legato-slide destinations, merged into clusters of ±30 ms.
 */
export function expectedAttacks(score: Score, scheduled: readonly NoteEvent[]): Cluster[] {
  const ordered = [...scheduled].sort((a, b) => a.when - b.when);
  const lastOnString = new Map<string, NoteEvent>();
  const attacks: Cluster[] = [];
  for (const event of ordered) {
    const stringKey = `${String(event.trackIndex)}:${String(event.note.string)}`;
    const previous = lastOnString.get(stringKey);
    lastOnString.set(stringKey, event);
    if (!audible(score, event.track)) continue;
    if (event.note.hammerPull) continue;
    if (event.note.string > 0 && previous?.note.slide?.includes('legato') === true) continue;
    attacks.push({ when: event.when, event });
  }
  const clusters: Cluster[] = [];
  for (const attack of attacks) {
    const last = clusters.at(-1);
    if (last && attack.when - last.when <= ATTACK_THRESHOLDS.clusterSeconds) continue;
    clusters.push(attack);
  }
  return clusters;
}

export interface AttackVerification {
  violation?: CheckViolation;
  clusters: number;
  heard: number;
  weak: number;
  missed: number;
  ratios: number[];
}

const quantile = (sorted: readonly number[], q: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))] ?? 0;

export function ratioStats(ratios: readonly number[]): {
  min: number;
  p10: number;
  median: number;
} {
  const sorted = [...ratios].sort((a, b) => a - b);
  return { min: sorted[0] ?? 0, p10: quantile(sorted, 0.1), median: quantile(sorted, 0.5) };
}

/** How many isolated missed attacks a song of `clusters` attacks may have before it fails. */
export function missAllowance(clusters: number): number {
  const { missShare, minMisses, maxMisses } = ATTACK_THRESHOLDS;
  return Math.min(maxMisses, Math.max(minMisses, missShare * clusters));
}

/** Spectral-flux attack ratios at every cluster of the mono mix. */
export function verifyAttacks(
  left: Signal,
  right: Signal,
  clusters: readonly Cluster[],
): AttackVerification {
  const mono = new Float32Array(left.data.length);
  for (let i = 0; i < mono.length; i += 1)
    mono[i] = ((left.data[i] ?? 0) + (right.data[i] ?? 0)) / 2;
  const flux = spectralFlux({ data: mono, sampleRate: left.sampleRate });
  const ratios = attackRatios(
    flux,
    clusters.map((cluster) => cluster.when),
  );
  const { heard: heardAt, missed: missedBelow, consecutive } = ATTACK_THRESHOLDS;
  let heard = 0;
  let weak = 0;
  let run = 0;
  let longest = 0;
  const misses: string[] = [];
  ratios.forEach((ratio, i) => {
    if (ratio >= heardAt) heard += 1;
    else if (ratio >= missedBelow) weak += 1;
    if (ratio < missedBelow) {
      run += 1;
      longest = Math.max(longest, run);
      const event = clusters[i]?.event;
      if (event && misses.length < 10) {
        misses.push(
          `bar ${String(event.masterBarIndex + 1)} (pass ${String(event.sequenceIndex + 1)}), ${describeTrack(event.track, event.trackIndex)}, ${event.when.toFixed(2)} s, ratio ${ratio.toFixed(2)}`,
        );
      }
    } else {
      run = 0;
    }
  });
  const missed = ratios.length - heard - weak;
  const result: AttackVerification = { clusters: clusters.length, heard, weak, missed, ratios };
  if (missed > missAllowance(clusters.length) || longest >= consecutive) {
    result.violation = {
      code: 'attack-missed',
      message: `${String(missed)} of ${String(clusters.length)} scheduled attacks are not heard in the render`,
      where: misses.join('; '),
      data: {
        recall: clusters.length === 0 ? 1 : (heard + weak) / clusters.length,
        misses: missed,
        clusters: clusters.length,
      },
    };
  }
  return result;
}
