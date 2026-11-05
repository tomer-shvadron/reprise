import type { SampleRef } from './region-map';

/**
 * Where decoded audio comes from. The SF2 and SFZ loaders implement it over their files, the
 * memory manager wraps it with its budget, and the sampler holds no buffer of its own.
 */
export interface SampleSource {
  /** Fetches and decodes when needed; resolves with the buffer once it is resident. */
  getBuffer(ref: SampleRef): Promise<AudioBuffer>;
  /** The buffer if it is resident now, without loading; a scheduled note cannot wait. */
  peekBuffer(ref: SampleRef): AudioBuffer | undefined;
}

export type SynthSample =
  | { kind: 'sine'; frequency: number; duration: number; amplitude?: number }
  | { kind: 'noise'; duration: number; seed?: number; amplitude?: number };

export function midiToFrequency(key: number): number {
  return 440 * 2 ** ((key - 69) / 12);
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function synthesize(spec: SynthSample, sampleRate: number): AudioBuffer {
  const length = Math.max(1, Math.round(spec.duration * sampleRate));
  const buffer = new AudioBuffer({ length, sampleRate, numberOfChannels: 1 });
  const data = buffer.getChannelData(0);
  const amplitude = spec.amplitude ?? 1;
  if (spec.kind === 'sine') {
    const step = (2 * Math.PI * spec.frequency) / sampleRate;
    for (let i = 0; i < length; i += 1) data[i] = amplitude * Math.sin(step * i);
  } else {
    const random = mulberry32(spec.seed ?? 1);
    for (let i = 0; i < length; i += 1) data[i] = amplitude * (random() * 2 - 1);
  }
  return buffer;
}

/**
 * An in-memory source that synthesizes its samples on first use. `deferred` makes samples
 * non-resident until `getBuffer` is awaited, the way a real loader behaves.
 */
export class SynthSampleSource implements SampleSource {
  readonly #specs: ReadonlyMap<SampleRef, SynthSample>;
  readonly #buffers = new Map<SampleRef, AudioBuffer>();
  readonly #sampleRate: number;
  readonly #deferred: boolean;
  requests = 0;

  constructor(
    sampleRate: number,
    samples: Readonly<Record<SampleRef, SynthSample>>,
    options: { deferred?: boolean } = {},
  ) {
    this.#sampleRate = sampleRate;
    this.#specs = new Map(Object.entries(samples));
    this.#deferred = options.deferred ?? false;
  }

  getBuffer(ref: SampleRef): Promise<AudioBuffer> {
    this.requests += 1;
    try {
      return Promise.resolve(this.#load(ref));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  peekBuffer(ref: SampleRef): AudioBuffer | undefined {
    if (this.#deferred) return this.#buffers.get(ref);
    return this.#specs.has(ref) ? this.#load(ref) : undefined;
  }

  #load(ref: SampleRef): AudioBuffer {
    const cached = this.#buffers.get(ref);
    if (cached) return cached;
    const spec = this.#specs.get(ref);
    if (!spec) throw new Error(`Unknown sample ${ref}`);
    const buffer = synthesize(spec, this.#sampleRate);
    this.#buffers.set(ref, buffer);
    return buffer;
  }
}
