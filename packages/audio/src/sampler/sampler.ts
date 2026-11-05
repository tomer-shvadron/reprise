import { midiNote } from '@reprise/model';
import type { Id, Note, Track } from '@reprise/model';

import { ChannelStrip, MasterBus, applySolo } from './channel-strip';
import type { RegionMap, SampleRef } from './region-map';
import type { SampleSource } from './sample-source';
import { Voice, velocityGain } from './voice';
import type { FilterSettings } from './voice';
import { VoicePool } from './voice-pool';

export const DEFAULT_POLYPHONY = 64;
/** About mf on the MIDI velocity curve. */
export const DEFAULT_VELOCITY = 96;
const PREVIEW_SECONDS = 0.6;

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
  offset?: number;
  /** Ignore note-off: ring until the next note on the string, or `until` when given. */
  letRing?: boolean | { until: number };
}

export interface SamplerOptions {
  polyphony?: number;
  destination?: AudioNode;
  previewVelocity?: number;
  previewSeconds?: number;
  /** A note whose sample was not resident: it was skipped and its load requested. */
  onMiss?: (track: Id, sample: SampleRef) => void;
}

/** The handle a note-on returns, for note-off and the articulation automation. */
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
  strip: ChannelStrip;
  voices: Set<Voice>;
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
  #misses = 0;

  constructor(context: BaseAudioContext, options: SamplerOptions = {}) {
    this.context = context;
    this.#options = options;
    this.master = new MasterBus(context, options.destination ?? context.destination);
    this.pool = new VoicePool(options.polyphony ?? DEFAULT_POLYPHONY);
  }

  get misses(): number {
    return this.#misses;
  }

  addTrack(track: SamplerTrack, instrument: Instrument): ChannelStrip {
    this.removeTrack(track.id);
    const strip = new ChannelStrip(this.context, this.master.input);
    this.#tracks.set(track.id, { track, instrument, strip, voices: new Set() });
    this.setTrack(track.id, track.channel);
    return strip;
  }

  setInstrument(id: Id, instrument: Instrument): void {
    this.#state(id).instrument = instrument;
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

  setTrack(id: Id, params: TrackParams): void {
    const { strip } = this.#state(id);
    strip.set({
      ...(params.volume !== undefined && { gain: channelVolumeToGain(params.volume) }),
      ...(params.pan !== undefined && { pan: channelPanToStereo(params.pan) }),
      ...(params.mute !== undefined && { mute: params.mute }),
      ...(params.solo !== undefined && { solo: params.solo }),
    });
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
      const region = regions.resolve(key, velocity, layer);
      if (region) samples.add(region.sample);
    }
    await Promise.all([...samples].map((sample) => source.getBuffer(sample)));
  }

  /**
   * Starts a note at `request.when`. Returns `undefined` when no region covers it, or when its
   * sample is not resident: a scheduled note cannot wait for a decode, so the load is requested
   * for the next time and the note is reported through `onMiss`.
   */
  noteOn(id: Id, request: NoteOnRequest): VoiceHandle | undefined {
    const state = this.#state(id);
    if (request.velocity <= 0) return undefined;
    const { regions, source } = state.instrument;
    const region = regions.resolve(request.key, request.velocity, request.layer);
    if (!region) return undefined;
    const buffer = source.peekBuffer(region.sample);
    if (!buffer) {
      this.#misses += 1;
      this.#options.onMiss?.(id, region.sample);
      // A failed load surfaces through `preload` or the memory manager, not mid-playback.
      source.getBuffer(region.sample).catch(() => undefined);
      return undefined;
    }

    const string = request.string ?? 0;
    if (string > 0) {
      for (const voice of state.voices) {
        if (voice.string === string && voice.isSoundingAt(request.when)) {
          voice.release(request.when);
        }
      }
    }

    this.pool.reserve(request.when);
    const voice = new Voice(
      this.context,
      state.strip.input,
      {
        track: id,
        region,
        buffer,
        key: request.key,
        velocity: request.velocity,
        when: request.when,
        string,
        ...(request.offset !== undefined && { offset: request.offset }),
      },
      (ended) => {
        state.voices.delete(ended);
        this.pool.remove(ended);
      },
    );
    state.voices.add(voice);
    this.pool.add(voice);
    if (request.letRing) {
      voice.letRing = true;
      if (typeof request.letRing === 'object') voice.release(request.letRing.until);
    }
    return voice;
  }

  /** Releases the note, unless it lets ring: then the next note on its string releases it. */
  noteOff(voice: VoiceHandle, when: number): void {
    if (!voice.letRing) voice.release(when);
  }

  /** Releases every voice, let-ring included, on one track or all of them. */
  allNotesOff(when: number, id?: Id): void {
    const states = id === undefined ? [...this.#tracks.values()] : [this.#state(id)];
    for (const state of states) {
      for (const voice of state.voices) voice.release(when);
    }
  }

  /** One note now, through the track's strip, at the preview velocity. */
  previewNote(id: Id, note: Pick<Note, 'string' | 'fret'>): VoiceHandle | undefined {
    const { track } = this.#state(id);
    const when = this.context.currentTime;
    const voice = this.noteOn(id, {
      key: midiNote(track, note),
      velocity: this.#options.previewVelocity ?? DEFAULT_VELOCITY,
      when,
      string: note.string,
    });
    voice?.release(when + (this.#options.previewSeconds ?? PREVIEW_SECONDS));
    return voice;
  }

  dispose(): void {
    for (const id of [...this.#tracks.keys()]) this.removeTrack(id);
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
