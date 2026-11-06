import { PPQ, beatTicks } from '@reprise/model';
import type { ChannelMixChange, Id, Track } from '@reprise/model';

import { DEAD_NOTE_KEY, deadNoteInstrument } from '../articulations/dead-note';
import { placeGraces } from '../articulations/grace';
import { ARTICULATION } from '../articulations/parameters';
import { planNote } from '../articulations/plan';
import type { GainPoint, NotePlan, PlanInput, Strike } from '../articulations/plan';
import { levelAt } from '../articulations/tie-chain';
import type { FilterSettings } from './voice';
import type { InstrumentSink, MixEvent, NoteEvent } from '../sink';
import type { Instrument, Sampler, TrackParams, VoiceHandle } from './sampler';

export interface SamplerSinkOptions {
  /** The dead-note burst; a synthesized noise region when absent. */
  deadNote?: Instrument;
  /**
   * The instrument a `MixEvent` program change switches the track to, from the beat on;
   * `undefined` (or no resolver) keeps the current one.
   */
  instrumentOf?: (track: Track, program: number) => Instrument | undefined;
}

/**
 * A legato slide's voice, carrying into the note on its string that starts at `at`. The
 * scheduler times both notes from one anchor, so the times match unless a tempo change fell
 * between them; then the slide ends there and the next note is struck.
 */
interface Chain {
  voice: VoiceHandle;
  at: number;
  /** The filter type the voice was left with, which the note it carries into keeps. */
  filterType: BiquadFilterType;
}

const CHAIN_TOLERANCE = 1e-4;
/** A pitch curve ends this long before the next note's events: one inside a curve's span throws. */
const CURVE_GAP = 2 * CHAIN_TOLERANCE;

function shapeGain(
  voice: VoiceHandle,
  points: readonly GainPoint[],
  from: number,
  to: number,
): void {
  if (points.length === 0) return;
  voice.setGain(levelAt(points, from), from);
  for (const [index, point] of points.entries()) {
    if (point.at <= from || point.at > to) continue;
    // Two points at one time are a step, which a ramp would turn into a glide from the last event.
    if (points[index - 1]?.at === point.at) voice.setGain(point.db, point.at);
    else voice.rampGain(point.db, point.at);
  }
  const last = points.at(-1);
  if (last && last.at > to) voice.rampGain(levelAt(points, to), to);
}

/**
 * Returns the filter type the voice is left with. A type switches at once, not at a time, so a
 * carried voice keeps its type and takes only the timed changes that need no switch.
 */
function shapeFilter(
  voice: VoiceHandle,
  plan: NotePlan,
  from: number,
  to: number,
  carried: BiquadFilterType | undefined,
): BiquadFilterType {
  let type = carried ?? 'lowpass';
  if (carried === undefined) {
    let onset: FilterSettings | undefined = plan.filter;
    for (const change of plan.filterChanges) if (change.at <= from) onset = change.filter;
    if (onset) voice.setFilter(onset, from);
    type = onset?.type ?? type;
  }
  for (const change of plan.filterChanges) {
    if (change.at <= from || change.at >= to) continue;
    const next = change.filter.type ?? type;
    if (carried !== undefined && next !== type) continue;
    voice.setFilter(change.filter, change.at);
    type = next;
  }
  return type;
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
 * through `mix` and is scheduled on the strip at the beat, and its program change on the track's
 * instrument.
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
      const filterType = shapeFilter(
        voice,
        plan,
        strike.when,
        until,
        isCarried ? chain?.filterType : undefined,
      );
      shapeGain(voice, plan.gain, strike.when, until);
      shapePitch(voice, plan, strike, until, isCarried);
      if (last && plan.legatoInto !== undefined) {
        chains.set(chainKey, { voice, at: plan.legatoInto, filterType });
      } else if (last && plan.letRingUntil !== undefined) {
        if (isCarried) voice.release(plan.letRingUntil);
      } else {
        voice.release(strike.end);
      }
    }
  }

  function mix(event: MixEvent): void {
    const { track, when, secondsPerTick } = event;
    const { volume, pan, program } = event.mix;
    const apply = (change: ChannelMixChange, params: TrackParams): void => {
      const ramp = (change.duration ?? 0) * PPQ * secondsPerTick;
      const ids = change.allTracks ? sampler.trackIds : [track.id];
      for (const id of ids) sampler.setTrack(id, params, { at: when, ramp });
    };
    if (volume) apply(volume, { volume: volume.value });
    if (pan) apply(pan, { pan: pan.value });
    const instrument = program === undefined ? undefined : options.instrumentOf?.(track, program);
    if (instrument) sampler.setInstrument(track.id, instrument, when);
  }

  return {
    noteOn(event: NoteEvent): void {
      const { track, beat, note } = event;
      const secondsPerTick = event.durationTicks > 0 ? event.duration / event.durationTicks : 0;
      const { graces, delay } = placeGraces(event, secondsPerTick, sampler.context.currentTime);
      for (const grace of graces) play(track.id, grace);
      const length = Math.max(0, event.duration - delay);
      const beatLength = Math.max(0, beatTicks(beat) * secondsPerTick - delay);
      play(track.id, {
        track,
        note,
        effects: beat.effects,
        when: event.when + delay,
        length,
        beatLength,
        links: event.continuations.map((link) => ({
          note: link.note,
          effects: link.beat.effects,
          when: link.when,
          length: link.durationTicks * secondsPerTick,
        })),
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
