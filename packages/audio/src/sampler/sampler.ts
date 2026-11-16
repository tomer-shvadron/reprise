import { midiNote } from '@reprise/model';
import type { Id, Note, Track } from '@reprise/model';

import { realtimeDefer } from '../effects/bypass-slot';
import type { Defer } from '../effects/bypass-slot';
import type { EffectSpec } from '../effects/presets';
import { ImpulseBank, ReverbBus } from '../effects/reverb-bus';
import { ChannelStrip, MasterBus, applySolo } from './channel-strip';
import type { StripEffects } from './channel-strip';
import type { Region, RegionMap, RegionSelection, SampleRef } from './region-map';
import type { SampleSource } from './sample-source';
import { Voice, velocityGain } from './voice';
import type { FilterSettings } from './voice';
import { VoicePool } from './voice-pool';

export const DEFAULT_POLYPHONY = 64;
/** About mf on the MIDI velocity curve. */
export const DEFAULT_VELOCITY = 96;
const PREVIEW_SECONDS = 0.6;
/** A preview waiting on a decode later than this is dropped. */
const PREVIEW_LATE_SECONDS = 0.5;

export interface Instrument {
  regions: RegionMap;
  source: SampleSource;
}

export type SamplerTrack = Pick<Track, 'id' | 'kind' | 'tuning' | 'capo' | 'channel'>;

/** The `AudioEngine.setTrack` parameters, in the model's 0..127 channel units. */
export interface TrackParams {
  volume?: number;
  pan?: number;
  mute?: boolean;
  solo?: boolean;
}

export interface NoteOnRequest {
  key: number;
  velocity: number;
  when: number;
  /** 1 = highest string; a new note on a string chokes the one sounding there. 0 never chokes. */
  string?: number;
  layer?: string;
  /**
   * The round-robin, random and legato counters the note's regions are chosen by, for the note's
   * regions and its release regions alike; absent plays the first take (`RegionMap.resolveAll`).
   */
  select?: RegionSelection;
  offset?: number;
  /** Ignore note-off: ring until the next note on the string, or `until` when given. */
  letRing?: boolean | { until: number };
  /** Plays a region of this instrument instead of the track's, through the track's strip. */
  instrument?: Instrument;
  /** A preview voice: see `Sampler.previewNote`. */
  preview?: boolean;
  /**
   * Whether this note's release starts its release regions (default true). A caller sets it false
   * on a strike whose string is not let go: a tremolo stroke, a trill alternation, a grace note.
   * Only the note's final release (the last strike, the end of a legato chain, the let-ring
   * `until`) should fire.
   */
  releaseTrigger?: boolean;
}

/** When a `setTrack` volume or pan change happens: at `at`, gliding over `ramp` seconds. */
export interface TrackParamsTiming {
  at: number;
  ramp?: number;
}

/** A note to preview: a fret on a string, resolved through the track's tuning and capo, or a bare MIDI key. */
export type PreviewNote = Pick<Note, 'string' | 'fret'> | { pitch: number };

export interface PreviewOptions {
  /** 1 to 127. */
  velocity?: number;
  /** Seconds until the note is released. */
  seconds?: number;
}

export interface SamplerOptions {
  polyphony?: number;
  destination?: AudioNode;
  previewVelocity?: number;
  previewSeconds?: number;
  /** Runs a callback when the context clock reaches a time; for idle effects paths to be disconnected. Tests inject one. */
  defer?: Defer;
  /** A note whose sample was not resident: it was skipped and its load requested. */
  onMiss?: (track: Id, sample: SampleRef) => void;
}

/**
 * The handle a note-on returns, for note-off and the articulation automation. `release(at)` also
 * starts the note's release regions (SFZ `trigger=release`) at `at`, once, unless the note was
 * already cut short (choked, stolen, stopped), is a preview or was started with `releaseTrigger:
 * false`; the let-ring `until` release does the same. Those voices are one-shots, outside the
 * string choke, tied to their note (a choke or steal before they start cancels them), and they
 * never steal a polyphony slot.
 */
export interface VoiceHandle {
  readonly track: Id;
  readonly key: number;
  readonly velocity: number;
  readonly string: number;
  readonly startTime: number;
  readonly endTime: number;
  readonly letRing: boolean;
  release(at: number): void;
  setDetune(semitones: number, at: number): void;
  rampDetune(semitones: number, at: number): void;
  detuneCurve(semitones: readonly number[], start: number, duration: number): void;
  setGain(db: number, at: number): void;
  rampGain(db: number, at: number): void;
  setFilter(settings: FilterSettings, at: number): void;
}

interface TrackState {
  track: SamplerTrack;
  instrument: Instrument;
  /** Program changes scheduled ahead, by time; each takes over from the one before at `at`. */
  changes: { at: number; instrument: Instrument }[];
  strip: ChannelStrip;
  voices: Set<Voice>;
  /** The preview waiting on a decode, by string (or by key with no string): the newest wins. */
  pendingPreviews: Map<string, object>;
}

/** One note's voices, a voice per layered region: every call applies to all of them. */
class LayeredVoice implements VoiceHandle {
  readonly track: Id;
  readonly key: number;
  readonly velocity: number;
  readonly string: number;
  readonly startTime: number;
  readonly #voices: readonly Voice[];
  #onRelease: ((at: number) => void) | undefined;

  constructor(voices: readonly [Voice, ...Voice[]], onRelease?: (at: number) => void) {
    this.#onRelease = onRelease;
    const [first] = voices;
    this.track = first.track;
    this.key = first.key;
    this.velocity = first.velocity;
    this.string = first.string;
    this.startTime = first.startTime;
    this.#voices = voices;
  }

  get endTime(): number {
    return Math.max(...this.#voices.map((voice) => voice.endTime));
  }

  get letRing(): boolean {
    return this.#voices.some((voice) => voice.letRing);
  }

  release(at: number): void {
    // A voice already released was choked, stolen or stopped: a cut note has no release sound.
    const cut = this.#voices.some((voice) => voice.released);
    for (const voice of this.#voices) voice.release(at);
    const onRelease = this.#onRelease;
    this.#onRelease = undefined;
    if (!cut) onRelease?.(at);
  }

  setDetune(semitones: number, at: number): void {
    for (const voice of this.#voices) voice.setDetune(semitones, at);
  }

  rampDetune(semitones: number, at: number): void {
    for (const voice of this.#voices) voice.rampDetune(semitones, at);
  }

  detuneCurve(semitones: readonly number[], start: number, duration: number): void {
    for (const voice of this.#voices) voice.detuneCurve(semitones, start, duration);
  }

  setGain(db: number, at: number): void {
    for (const voice of this.#voices) voice.setGain(db, at);
  }

  rampGain(db: number, at: number): void {
    for (const voice of this.#voices) voice.rampGain(db, at);
  }

  setFilter(settings: FilterSettings, at: number): void {
    for (const voice of this.#voices) voice.setFilter(settings, at);
  }
}

/** Channel volume follows the MIDI curve, the same as velocity. */
export function channelVolumeToGain(volume: number): number {
  return velocityGain(volume);
}

export function channelPanToStereo(pan: number): number {
  return Math.min(1, Math.max(-1, (pan - 64) / 63));
}

export class Sampler {
  readonly context: BaseAudioContext;
  readonly master: MasterBus;
  readonly pool: VoicePool;
  readonly #tracks = new Map<Id, TrackState>();
  readonly #options: SamplerOptions;
  readonly #effects: StripEffects;
  #impulses: ImpulseBank | undefined;
  #reverb: ReverbBus | undefined;
  #misses = 0;
  #skippedReleases = 0;

  constructor(context: BaseAudioContext, options: SamplerOptions = {}) {
    this.context = context;
    this.#options = options;
    this.#effects = {
      impulses: () => (this.#impulses ??= new ImpulseBank(context)),
      reverb: () => this.#reverbBus().input,
      defer: options.defer ?? realtimeDefer(context),
    };
    this.master = new MasterBus(context, options.destination ?? context.destination);
    this.pool = new VoicePool(options.polyphony ?? DEFAULT_POLYPHONY);
  }

  /** Samples found not resident at a note: one per missing layer, not per note. */
  get misses(): number {
    return this.#misses;
  }

  /** Release samples skipped because the pool was full at their start: they never steal. */
  get skippedReleases(): number {
    return this.#skippedReleases;
  }

  /** The shared reverb bus, once a strip has sent to it. */
  get reverbBus(): ReverbBus | undefined {
    return this.#reverb;
  }

  get impulseBytes(): number {
    return this.#impulses?.bytes ?? 0;
  }

  #reverbBus(): ReverbBus {
    this.#impulses ??= new ImpulseBank(this.context);
    this.#reverb ??= new ReverbBus(this.context, this.#impulses, this.master.input);
    return this.#reverb;
  }

  /** Moves a track's strip to the effects `spec`, glitch-free; `undefined` is no effects at all. */
  setEffects(id: Id, spec: EffectSpec | undefined): void {
    this.#state(id).strip.setEffects(spec);
  }

  get trackIds(): Id[] {
    return [...this.#tracks.keys()];
  }

  addTrack(track: SamplerTrack, instrument: Instrument): ChannelStrip {
    this.removeTrack(track.id);
    const strip = new ChannelStrip(this.context, this.master.input, this.#effects);
    this.#tracks.set(track.id, {
      track,
      instrument,
      changes: [],
      strip,
      voices: new Set(),
      pendingPreviews: new Map(),
    });
    this.setTrack(track.id, track.channel);
    return strip;
  }

  /**
   * Switches the track's instrument now, or from `at` on for a program change scheduled on a beat:
   * a note starting before `at` keeps the instrument in effect at its own start.
   */
  setInstrument(id: Id, instrument: Instrument, at?: number): void {
    const state = this.#state(id);
    if (at === undefined) {
      state.instrument = instrument;
      state.changes = [];
      return;
    }
    state.changes = state.changes.filter((change) => change.at < at);
    state.changes.push({ at, instrument });
  }

  /** The instrument a note starting at `when` plays; changes already in the past are folded in. */
  instrumentAt(id: Id, when: number): Instrument {
    return this.#instrumentAt(this.#state(id), when);
  }

  #instrumentAt(state: TrackState, when: number): Instrument {
    const now = this.context.currentTime;
    while (state.changes[0] && state.changes[0].at <= now) {
      state.instrument = state.changes[0].instrument;
      state.changes.shift();
    }
    let instrument = state.instrument;
    for (const change of state.changes) if (change.at <= when) instrument = change.instrument;
    return instrument;
  }

  removeTrack(id: Id): void {
    const state = this.#tracks.get(id);
    if (!state) return;
    for (const voice of state.voices) voice.kill(this.context.currentTime);
    state.strip.dispose();
    this.#tracks.delete(id);
    applySolo(this.#strips());
  }

  strip(id: Id): ChannelStrip | undefined {
    return this.#tracks.get(id)?.strip;
  }

  /** Now, or volume and pan at `timing.at` for a scheduled mixer change; mute and solo are always now. */
  setTrack(id: Id, params: TrackParams, timing?: TrackParamsTiming): void {
    const { strip } = this.#state(id);
    strip.set(
      {
        ...(params.volume !== undefined && { gain: channelVolumeToGain(params.volume) }),
        ...(params.pan !== undefined && { pan: channelPanToStereo(params.pan) }),
        ...(params.mute !== undefined && { mute: params.mute }),
        ...(params.solo !== undefined && { solo: params.solo }),
      },
      timing?.at,
      timing?.ramp,
    );
    applySolo(this.#strips());
  }

  /** Resolves when every sample these notes need is resident. */
  async preload(
    id: Id,
    notes: readonly { key: number; velocity: number; layer?: string }[],
  ): Promise<void> {
    const { regions, source } = this.#state(id).instrument;
    const samples = new Set<SampleRef>();
    for (const { key, velocity, layer } of notes) {
      for (const region of regions.candidates(key, velocity, layer)) samples.add(region.sample);
    }
    await Promise.all([...samples].map((sample) => source.getBuffer(sample)));
  }

  /**
   * Starts a note at `request.when`, one voice per region layered on its key and velocity, behind
   * one handle. Returns `undefined` when no region covers it, or when none of its samples is
   * resident: a scheduled note cannot wait for a decode, so each missing sample's load is requested
   * for the next time and reported through `onMiss`, and the resident layers play without it.
   */
  noteOn(id: Id, request: NoteOnRequest): VoiceHandle | undefined {
    const state = this.#state(id);
    return this.#start(state, request, state.strip.input);
  }

  #start(
    state: TrackState,
    request: NoteOnRequest,
    destination: AudioNode,
  ): VoiceHandle | undefined {
    const id = state.track.id;
    if (request.velocity <= 0) return undefined;
    const { regions, source } = request.instrument ?? this.#instrumentAt(state, request.when);
    const layers: { region: Region; buffer: AudioBuffer }[] = [];
    const resolved = regions.resolveAll(
      request.key,
      request.velocity,
      request.layer,
      request.select,
    );
    for (const region of resolved) {
      const buffer = source.peekBuffer(region.sample);
      if (buffer) {
        layers.push({ region, buffer });
        continue;
      }
      this.#misses += 1;
      this.#options.onMiss?.(id, region.sample);
      // A failed load surfaces through `preload` or the memory manager, not mid-playback.
      source.getBuffer(region.sample).catch(() => undefined);
    }
    if (layers.length === 0) return undefined;

    const string = request.string ?? 0;
    // SF2's exclusive class c is group = offBy = c; an SFZ group chokes only voices off_by it.
    const groups = new Set(layers.map(({ region }) => region.group ?? region.exclusiveClass ?? 0));
    groups.delete(0);
    for (const voice of state.voices) {
      if (!voice.isSoundingAt(request.when)) continue;
      // Previews and the song never choke each other: a preview retriggers its own string (or its
      // own key, with no string), and a song note chokes song voices only.
      if (voice.preview !== (request.preview ?? false)) continue;
      const struck = request.preview
        ? string > 0
          ? voice.string === string
          : voice.string === 0 && voice.key === request.key
        : string > 0 && voice.string === string;
      const excluded = !request.preview && voice.instrument === regions && groups.has(voice.offBy);
      if (struck || excluded) voice.choke(request.when);
    }

    const voices: Voice[] = [];
    for (const { region, buffer } of layers) {
      this.pool.reserve(request.when);
      const voice = new Voice(
        this.context,
        destination,
        {
          track: id,
          region,
          buffer,
          key: request.key,
          velocity: request.velocity,
          when: request.when,
          string,
          preview: request.preview ?? false,
          instrument: regions,
          ...(request.offset !== undefined && { offset: request.offset }),
        },
        (ended) => {
          state.voices.delete(ended);
          this.pool.remove(ended);
        },
      );
      state.voices.add(voice);
      this.pool.add(voice);
      if (request.letRing) voice.letRing = true;
      voices.push(voice);
    }
    const [first, ...rest] = voices;
    if (!first) return undefined;
    // Only a note whose map has release regions for it pays for the hook; a GM note is unchanged.
    const releases =
      !request.preview &&
      request.releaseTrigger !== false &&
      regions.hasReleaseRegions &&
      regions.resolveRelease(request.key, request.velocity, request.layer, request.select).length >
        0;
    const handle: VoiceHandle =
      rest.length === 0 && !releases
        ? first
        : new LayeredVoice(
            [first, ...rest],
            releases
              ? (at) => {
                  const tails = this.#startRelease(
                    state,
                    request,
                    { regions, source },
                    destination,
                    at,
                  );
                  // The tails belong to the note: a later choke or steal before they start cancels them.
                  for (const voice of voices) voice.tails.push(...tails);
                }
              : undefined,
          );
    if (typeof request.letRing === 'object') handle.release(request.letRing.until);
    return handle;
  }

  /**
   * The release regions of a note whose note-off is at `at`. A release sample that is not
   * resident is a miss like any other: skipped, its load requested, reported through `onMiss`.
   * Each is a one-shot with `string` 0, so no later note on the string chokes it, and its
   * `releaseDecay` lowers it by the seconds the note was held.
   */
  #startRelease(
    state: TrackState,
    request: NoteOnRequest,
    { regions, source }: Instrument,
    destination: AudioNode,
    at: number,
  ): Voice[] {
    const id = state.track.id;
    const tails: Voice[] = [];
    const held = Math.max(0, at - request.when);
    for (const region of regions.resolveRelease(
      request.key,
      request.velocity,
      request.layer,
      request.select,
    )) {
      const buffer = source.peekBuffer(region.sample);
      if (!buffer) {
        this.#misses += 1;
        this.#options.onMiss?.(id, region.sample);
        source.getBuffer(region.sample).catch(() => undefined);
        continue;
      }
      // Decoration never steals: a waiting tail would also hold a slot from the note-on.
      if (this.pool.countAt(at) >= this.pool.polyphony) {
        this.#skippedReleases += 1;
        continue;
      }
      const voice = new Voice(
        this.context,
        destination,
        {
          track: id,
          tail: true,
          region: {
            ...region,
            oneShot: true,
            ...((region.releaseDecay ?? 0) > 0 && {
              attenuation: (region.attenuation ?? 0) + (region.releaseDecay ?? 0) * held,
            }),
          },
          buffer,
          key: request.key,
          velocity: request.velocity,
          when: at,
          string: 0,
          preview: false,
          instrument: regions,
        },
        (ended) => {
          state.voices.delete(ended);
          this.pool.remove(ended);
        },
      );
      state.voices.add(voice);
      this.pool.add(voice);
      tails.push(voice);
    }
    return tails;
  }

  /** Releases the note, unless it lets ring: then the next note on its string releases it. */
  noteOff(voice: VoiceHandle, when: number): void {
    if (!voice.letRing) voice.release(when);
  }

  /**
   * Releases every voice, let-ring included, on one track or all of them, and drops the
   * instrument changes and the strips' volume and pan changes scheduled after `when`: the
   * scheduler sends a change again when playback reaches its beat, so one left over from a stop,
   * pause or seek would only land early, or over the baseline a stop restores.
   */
  allNotesOff(when: number, id?: Id): void {
    const states = id === undefined ? [...this.#tracks.values()] : [this.#state(id)];
    for (const state of states) {
      state.pendingPreviews.clear();
      for (const voice of state.voices) voice.stop(when);
      state.changes = state.changes.filter((change) => change.at <= when);
      state.strip.cancelAfter(when);
    }
  }

  /**
   * One note now through the track's strip, past its mute gate: a note clicked in the editor
   * sounds even on a muted track or with another track soloed. Played by `options.velocity`
   * (default the preview velocity) and released after `options.seconds` (default the preview
   * length); a `pitch` note sounds that MIDI key and has no string.
   *
   * Preview voices choke only previews: the one before on the same string, or on the same key for
   * a `pitch` note. The song's voices never choke a preview and a preview never chokes them.
   *
   * A sample not yet decoded cannot sound now: its decode is requested and the note starts once
   * it is resident, unless that takes longer than `PREVIEW_LATE_SECONDS`, when late feedback is
   * worse than none. A newer preview on the same string (or key) cancels a waiting one, a stop
   * cancels it too, and the late note's length is cut by the wait. The returned handle is then
   * `undefined`.
   */
  previewNote(id: Id, note: PreviewNote, options: PreviewOptions = {}): VoiceHandle | undefined {
    const state = this.#state(id);
    const velocity = options.velocity ?? this.#options.previewVelocity ?? DEFAULT_VELOCITY;
    const seconds = options.seconds ?? this.#options.previewSeconds ?? PREVIEW_SECONDS;
    const key = 'pitch' in note ? note.pitch : midiNote(state.track, note);
    const string = 'pitch' in note ? 0 : note.string;
    const slot = string > 0 ? `string:${String(string)}` : `key:${String(key)}`;
    state.pendingPreviews.delete(slot);
    const requested = this.context.currentTime;
    const play = (): VoiceHandle | undefined => {
      const when = this.context.currentTime;
      const voice = this.#start(
        state,
        { key, velocity, when, string, preview: true },
        state.strip.previewInput,
      );
      voice?.release(when + Math.max(0, seconds - (when - requested)));
      return voice;
    };
    const misses = this.#misses;
    const voice = play();
    if (!voice && this.#misses > misses) {
      const token = {};
      state.pendingPreviews.set(slot, token);
      // The miss above already requested the decode; `preload` joins it.
      this.preload(id, [{ key, velocity }]).then(
        () => {
          if (state.pendingPreviews.get(slot) !== token) return;
          state.pendingPreviews.delete(slot);
          if (
            this.#tracks.get(id) === state &&
            this.context.currentTime - requested <= PREVIEW_LATE_SECONDS
          ) {
            play();
          }
        },
        () => {
          if (state.pendingPreviews.get(slot) === token) state.pendingPreviews.delete(slot);
        },
      );
    }
    return voice;
  }

  dispose(): void {
    for (const id of [...this.#tracks.keys()]) this.removeTrack(id);
    this.#reverb?.dispose();
    this.master.dispose();
  }

  #state(id: Id): TrackState {
    const state = this.#tracks.get(id);
    if (!state) throw new Error(`No track ${id} in the sampler`);
    return state;
  }

  #strips(): ChannelStrip[] {
    return [...this.#tracks.values()].map((state) => state.strip);
  }
}
