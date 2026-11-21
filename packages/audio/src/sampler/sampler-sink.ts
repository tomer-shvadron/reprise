import { PPQ, beatTicks, courseOffset } from '@reprise/model';
import type { ChannelMixChange, Id, Track } from '@reprise/model';

import { DEAD_NOTE_KEY, deadNoteInstrument } from '../articulations/dead-note';
import { placeGraces } from '../articulations/grace';
import { ARTICULATION } from '../articulations/parameters';
import { planNote } from '../articulations/plan';
import { availableSets, voicingOf } from '../articulations/sets';
import type { ArticulationSet, NoteVoicing, SetVoicing, Voicing } from '../articulations/sets';
import type { GainPoint, NotePlan, PlanInput, Strike } from '../articulations/plan';
import { levelAt } from '../articulations/tie-chain';
import type { FilterSettings } from './voice';
import type { InstrumentSink, MixEvent, NoteEvent } from '../sink';
import type { RegionMap, RegionSelection } from './region-map';
import type { Instrument, Sampler, TrackParams, VoiceHandle } from './sampler';

export interface SamplerSinkOptions {
  /** The dead-note burst; a synthesized noise region when absent. */
  deadNote?: Instrument;
  /**
   * The instrument a `MixEvent` program change switches the track to, from the beat on;
   * `undefined` (or no resolver) keeps the current one.
   */
  instrumentOf?: (track: Track, program: number) => Instrument | undefined;
  /**
   * What the track's sample pack offers beyond its default instrument; `undefined`, or no
   * resolver, is a track with none (General MIDI), which plays as it always did.
   */
  voicingFor?: (track: Track) => Voicing | undefined;
}

const NO_SETS: ReadonlySet<ArticulationSet> = new Set();

/** What one `NoteEvent` hands every strike it plays, its grace notes included. */
interface Pass {
  voicing: Voicing | undefined;
  /** The sets the voicing has, for `voicingOf`; empty without one. */
  available: ReadonlySet<ArticulationSet>;
  sequenceIndex: number;
  /** The next note on the string has grace notes on its beat, which strike before it does. */
  nextOnBeatGrace: boolean;
}

/** FNV-1a over the parts, mapped to [0, 1): no `Math.random`, so a render repeats exactly. */
function draw(...parts: readonly (string | number)[]): number {
  let hash = 0x81_1c_9d_c5;
  for (const char of parts.join(':')) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01_00_01_93);
  }
  return (hash >>> 0) / 2 ** 32;
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
  /** The set the voice was struck with: the sample it keeps, whatever the next note's set. */
  set: ArticulationSet;
}

const CHAIN_TOLERANCE = 1e-4;
/** A pitch curve ends this long before the next note's events: one inside a curve's span throws. */
const CURVE_GAP = 2 * CHAIN_TOLERANCE;

/**
 * Whether the string passes straight to a hammer-on or pull-off when the note is let go: the
 * string is not let go there, so the note's release sample is left to the end of the chain, the
 * last note's own release. `releaseAt` is the moment the voice is released, the let-ring end for
 * a ringing note. A grace note on the hammered note's beat is struck first, so the string has
 * changed hands by then and the release stays.
 */
function handsOver(input: PlanInput, releaseAt: number, nextOnBeatGrace: boolean): boolean {
  const { next } = input;
  return (
    next?.note.hammerPull === true && !nextOnBeatGrace && next.when <= releaseAt + CHAIN_TOLERANCE
  );
}

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
  // Notes struck so far per track, region map, layer and key, for the round robins; a stop starts over.
  let counters = new WeakMap<RegionMap, Map<string, number>>();

  /** The counters a strike's regions are chosen by; `sequence` advances with each strike. */
  function select(
    trackId: Id,
    regions: RegionMap,
    input: PlanInput,
    pass: Pass,
    strikeIndex: number,
    key: number,
    layer?: string,
    legato = false,
  ): RegionSelection {
    let counts = counters.get(regions);
    if (!counts) {
      counts = new Map<string, number>();
      counters.set(regions, counts);
    }
    // The layer is in the slot so a palm-mute and a sustain strike of one key rotate apart; `undefined` until a layer is passed.
    const slot = `${trackId}:${layer ?? ''}:${String(key)}`;
    const sequence = counts.get(slot) ?? 0;
    counts.set(slot, sequence + 1);
    return {
      sequence,
      random: draw(input.note.id, pass.sequenceIndex, strikeIndex),
      ...(legato && { legato: true }),
    };
  }

  function start(
    trackId: Id,
    input: PlanInput,
    plan: NotePlan,
    strike: Strike,
    last: boolean,
    pass: Pass,
    strikeIndex: number,
    final: boolean,
    set: SetVoicing | undefined,
  ): VoiceHandle | undefined {
    if (plan.dead) deadNote ??= deadNoteInstrument(sampler.context.sampleRate);
    const burst = plan.dead && deadNote ? deadNote : undefined;
    // The set's own file, else the default instrument (read at the strike, a program change moves it).
    const own = burst ?? set?.instrument;
    const instrument = own ?? sampler.instrumentAt(trackId, strike.when);
    const layer = burst ? undefined : set?.layer;
    const key = plan.dead ? DEAD_NOTE_KEY : strike.key;
    // The layer actually played decides, not any keyswitch layer of the pack.
    const legato =
      pass.voicing?.legatoTrigger === true &&
      input.note.hammerPull &&
      instrument.regions.hasLegatoRegionsIn(layer);
    const selection = select(
      trackId,
      instrument.regions,
      input,
      pass,
      strikeIndex,
      key,
      layer,
      legato,
    );
    // A legato region is itself the transition, so its start is not trimmed further: only when one
    // really plays on this key, not merely exists in the layer.
    const transition =
      legato &&
      instrument.regions
        .resolveAll(key, strike.velocity, layer, selection)
        .some((region) => region.trigger === 'legato');
    // A dead note is one noise burst and a ghost note one light stroke, not a strummed pair.
    const course =
      plan.dead || input.note.ghost ? null : courseOffset(input.track, input.note.string);
    return sampler.noteOn(trackId, {
      key,
      ...(course !== null && { course }),
      velocity: strike.velocity,
      when: strike.when,
      string: input.note.string,
      ...(layer !== undefined && { layer }),
      select: selection,
      // Only a note's final release plays its release regions: not a tremolo stroke, a trill
      // alternation or a grace note, whose string is never let go, and not a note a hammer-on
      // or pull-off starts from, which stays on the string until the legato chain ends.
      releaseTrigger:
        final && last && !handsOver(input, plan.letRingUntil ?? strike.end, pass.nextOnBeatGrace),
      ...(strike.offset !== undefined && !transition && { offset: strike.offset }),
      ...(own && { instrument: own }),
      ...(last && plan.letRingUntil !== undefined && { letRing: { until: plan.letRingUntil } }),
    });
  }

  function play(trackId: Id, input: PlanInput, pass: Pass, final: boolean): void {
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
    const chosen: NoteVoicing = voicingOf(
      { kind: input.track.kind, note: input.note, effects: input.effects },
      pass.available,
    );
    const set = chosen.set === 'default' ? undefined : pass.voicing?.sets[chosen.set];
    // A carried voice keeps the sample it was struck with, so the effects the new note's set
    // would have sampled are still the synthesized ones when the sets differ.
    const sampled = carried && chain?.set !== chosen.set ? undefined : chosen.sampled;
    const plan = planNote({
      ...input,
      ...(carried && { continues: carried.key }),
      ...(sampled && { sampled }),
    });
    const lastIndex = plan.strikes.length - 1;
    for (const [index, strike] of plan.strikes.entries()) {
      const last = index === lastIndex;
      const voice =
        index === 0 && carried
          ? carried
          : start(trackId, input, plan, strike, last, pass, index, final, set);
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
        chains.set(chainKey, {
          voice,
          at: plan.legatoInto,
          filterType,
          // A second carry still holds the sample of the note that struck the voice.
          set: isCarried && chain ? chain.set : chosen.set,
        });
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
      const voicing = options.voicingFor?.(track);
      const next = event.nextOnString;
      const pass: Pass = {
        voicing,
        available: voicing ? availableSets(voicing.sets) : NO_SETS,
        sequenceIndex: event.sequenceIndex,
        // Only a grace note on the next note's own string takes the string before it.
        nextOnBeatGrace:
          next?.beat.grace?.some(
            (grace) => !grace.before && grace.notes.some((n) => n.string === next.note.string),
          ) ?? false,
      };
      for (const grace of graces) play(track.id, grace, pass, false);
      const length = Math.max(0, event.duration - delay);
      const beatLength = Math.max(0, beatTicks(beat) * secondsPerTick - delay);
      play(
        track.id,
        {
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
        },
        pass,
        true,
      );
    },
    mix,
    allNotesOff(when: number): void {
      chains.clear();
      counters = new WeakMap();
      sampler.allNotesOff(when);
    },
  };
}
