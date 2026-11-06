import { PPQ, beatTicks } from '@reprise/model';
import type { ChannelMixChange, Id } from '@reprise/model';

import { DEAD_NOTE_KEY, deadNoteInstrument } from '../articulations/dead-note';
import { placeGraces } from '../articulations/grace';
import { ARTICULATION } from '../articulations/parameters';
import { planNote } from '../articulations/plan';
import type { GainPoint, NotePlan, PlanInput, Strike } from '../articulations/plan';
import type { InstrumentSink, MixEvent, NoteEvent } from '../sink';
import type { Instrument, Sampler, TrackParams, VoiceHandle } from './sampler';

export interface SamplerSinkOptions {
  /** The dead-note burst; a synthesized noise region when absent. */
  deadNote?: Instrument;
}

/**
 * A legato slide's voice, carrying into the note on its string that starts at `at`. The
 * scheduler times both notes from one anchor, so the times match unless a tempo change fell
 * between them; then the slide ends there and the next note is struck.
 */
interface Chain {
  voice: VoiceHandle;
  at: number;
}

const CHAIN_TOLERANCE = 1e-4;
/** A pitch curve ends this long before the next note's events: one inside a curve's span throws. */
const CURVE_GAP = 2 * CHAIN_TOLERANCE;

function gainAt(points: readonly GainPoint[], time: number): number {
  let previous = points[0];
  if (!previous) return 0;
  if (time <= previous.at) return previous.db;
  for (const point of points) {
    if (time <= point.at) {
      const share = point.at > previous.at ? (time - previous.at) / (point.at - previous.at) : 1;
      return previous.db + (point.db - previous.db) * share;
    }
    previous = point;
  }
  return previous.db;
}

function shapeGain(
  voice: VoiceHandle,
  points: readonly GainPoint[],
  from: number,
  to: number,
): void {
  if (points.length === 0) return;
  voice.setGain(gainAt(points, from), from);
  for (const point of points) {
    if (point.at > from && point.at <= to) voice.rampGain(point.db, point.at);
  }
  const last = points.at(-1);
  if (last && last.at > to) voice.rampGain(gainAt(points, to), to);
}

function shapePitch(
  voice: VoiceHandle,
  plan: NotePlan,
  strike: Strike,
  to: number,
  carried: boolean,
): void {
  const { pitch } = plan;
  const span = to - strike.when - CURVE_GAP;
  if (!pitch || span <= 0) {
    if (strike.detune !== 0 || carried) voice.setDetune(strike.detune, strike.when);
    return;
  }
  const count = Math.max(2, Math.ceil(span / ARTICULATION.curveStep) + 1);
  const values = Array.from(
    { length: count },
    (_, index) => strike.detune + pitch(strike.when + (index * span) / (count - 1)),
  );
  voice.detuneCurve(values, strike.when, span);
}

/**
 * The scheduler's `InstrumentSink` over the sampler, with the articulation layer: each event,
 * and each grace note before or on its beat, becomes a `NotePlan` of attacks, pitch and level
 * automation, a filter and a release (`src/articulations/`). A beat's mixer change arrives
 * through `mix` and is scheduled on the strip at the beat.
 */
export function createSamplerSink(
  sampler: Sampler,
  options: SamplerSinkOptions = {},
): InstrumentSink {
  let deadNote = options.deadNote;
  const chains = new Map<string, Chain>();

  function start(
    trackId: Id,
    input: PlanInput,
    plan: NotePlan,
    strike: Strike,
    last: boolean,
  ): VoiceHandle | undefined {
    if (plan.dead) deadNote ??= deadNoteInstrument(sampler.context.sampleRate);
    return sampler.noteOn(trackId, {
      key: plan.dead ? DEAD_NOTE_KEY : strike.key,
      velocity: strike.velocity,
      when: strike.when,
      string: input.note.string,
      ...(strike.offset !== undefined && { offset: strike.offset }),
      ...(plan.dead && deadNote && { instrument: deadNote }),
      ...(last && plan.letRingUntil !== undefined && { letRing: { until: plan.letRingUntil } }),
    });
  }

  function play(trackId: Id, input: PlanInput): void {
    const chainKey = `${trackId}:${String(input.note.string)}`;
    const chain = input.note.string > 0 ? chains.get(chainKey) : undefined;
    let carried: VoiceHandle | undefined;
    if (chain) {
      chains.delete(chainKey);
      if (Math.abs(chain.at - input.when) <= CHAIN_TOLERANCE && !input.note.dead) {
        carried = chain.voice;
      } else {
        chain.voice.release(chain.at);
      }
    }
    const plan = planNote(carried ? { ...input, continues: carried.key } : input);
    const lastIndex = plan.strikes.length - 1;
    for (const [index, strike] of plan.strikes.entries()) {
      const last = index === lastIndex;
      const voice = index === 0 && carried ? carried : start(trackId, input, plan, strike, last);
      if (!voice) continue;
      const isCarried = voice === carried;
      const until = last && plan.legatoInto !== undefined ? plan.legatoInto : strike.end;
      // A filter's type switches at once, so a carried voice keeps the tone it was struck with.
      if (plan.filter && !isCarried) voice.setFilter(plan.filter, strike.when);
      shapeGain(voice, plan.gain, strike.when, until);
      shapePitch(voice, plan, strike, until, isCarried);
      if (last && plan.legatoInto !== undefined) {
        chains.set(chainKey, { voice, at: plan.legatoInto });
      } else if (last && plan.letRingUntil !== undefined) {
        if (isCarried) voice.release(plan.letRingUntil);
      } else {
        voice.release(strike.end);
      }
    }
  }

  function mix(event: MixEvent): void {
    const { track, when, secondsPerTick } = event;
    const { volume, pan } = event.mix;
    const apply = (change: ChannelMixChange, params: TrackParams): void => {
      const ramp = (change.duration ?? 0) * PPQ * secondsPerTick;
      const ids = change.allTracks ? sampler.trackIds : [track.id];
      for (const id of ids) sampler.setTrack(id, params, { at: when, ramp });
    };
    if (volume) apply(volume, { volume: volume.value });
    if (pan) apply(pan, { pan: pan.value });
  }

  return {
    noteOn(event: NoteEvent): void {
      const { track, beat, note } = event;
      const secondsPerTick = event.durationTicks > 0 ? event.duration / event.durationTicks : 0;
      const { graces, delay } = placeGraces(event, secondsPerTick, sampler.context.currentTime);
      for (const grace of graces) play(track.id, grace);
      play(track.id, {
        track,
        note,
        effects: beat.effects,
        when: event.when + delay,
        length: Math.max(0, event.duration - delay),
        beatLength: Math.max(0, beatTicks(beat) * secondsPerTick - delay),
        secondsPerTick,
        barEnd: event.barEnd,
        next: event.nextOnString,
      });
    },
    mix,
    allNotesOff(when: number): void {
      chains.clear();
      sampler.allNotesOff(when);
    },
  };
}
