import type { Score } from '@reprise/model';

import type { RegionMap, SampleRef } from '../sampler/region-map';
import type { SampleSource } from '../sampler/sample-source';
import { planInstruments, planSamples } from './plan';
import type { PlanOptions, SongPlan } from './plan';
import type { InstrumentId, RawSample, SampleProvider } from './types';

export const MEGABYTE = 1024 * 1024;
/** The roadmap's budgets: any song on the GM tier, and the HQ tier's default. */
export const GM_BUDGET_BYTES = 80 * MEGABYTE;
export const HQ_BUDGET_BYTES = 300 * MEGABYTE;
export const DEFAULT_PRELOAD_BARS = 4;

/** What a `BaseAudioContext` offers for building buffers; an `OfflineAudioContext` will do. */
export interface BufferFactory {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
}

export interface MemoryStats {
  decodedBytes: number;
  budgetBytes: number;
  /** Instruments with at least one decoded sample, sorted. */
  residents: InstrumentId[];
}

export interface MemoryCounters {
  fetches: number;
  evictions: number;
  /** Evictions of an instrument the current song uses: the budget is below the song's needs. */
  pinnedEvictions: number;
}

export interface ManagedSampleSourceOptions {
  budgetBytes?: number;
  /** Runs the coalesced `memory` notification; the next animation frame by default. */
  schedule?: (callback: () => void) => void;
}

export type RegionMaps = (instrument: InstrumentId) => RegionMap | undefined;

export interface LoadOptions extends Omit<PlanOptions, 'bars'> {
  /** Bars of the playback sequence decoded before `load` resolves. */
  bars?: number;
  /**
   * Then decode the rest of the song in the background, so a later bar does not skip notes;
   * only when all of it fits, since otherwise it would evict what the opening bars need.
   */
  warm?: boolean;
}

interface Resident {
  buffers: Map<SampleRef, AudioBuffer>;
  bytes: number;
}

export function bufferBytes(buffer: AudioBuffer): number {
  return buffer.numberOfChannels * buffer.length * Float32Array.BYTES_PER_ELEMENT;
}

function nextFrame(callback: () => void): void {
  if ('requestAnimationFrame' in globalThis) {
    requestAnimationFrame(() => {
      callback();
    });
  } else {
    setTimeout(callback, 16);
  }
}

function checkBudget(bytes: number): number {
  if (!Number.isFinite(bytes) || bytes < 0) {
    throw new RangeError(`Budget ${String(bytes)} is not a non-negative byte count`);
  }
  return bytes;
}

function decode(factory: BufferFactory, raw: RawSample): AudioBuffer {
  const length = raw.channels[0]?.length;
  if (length === undefined || raw.channels.some((channel) => channel.length !== length)) {
    throw new RangeError('A sample needs at least one channel, all of one length');
  }
  const buffer = factory.createBuffer(raw.channels.length, Math.max(1, length), raw.sampleRate);
  for (const [index, channel] of raw.channels.entries()) buffer.getChannelData(index).set(channel);
  return buffer;
}

/**
 * The decoded-buffer cache of ADR-0005, as the `SampleSource` every instrument plays from.
 * Accounting is per buffer, eviction is per instrument (a half-evicted instrument would only
 * trade a few bytes for skipped notes), least recently used first, and the current song's
 * instruments go last.
 */
export class ManagedSampleSource implements SampleSource {
  readonly #provider: SampleProvider;
  readonly #factory: BufferFactory;
  readonly #schedule: (callback: () => void) => void;
  /** Map order is recency: the first entry is the least recently used. */
  readonly #residents = new Map<InstrumentId, Resident>();
  readonly #owner = new Map<SampleRef, InstrumentId>();
  readonly #pending = new Map<SampleRef, Promise<AudioBuffer>>();
  readonly #listeners = new Set<(stats: MemoryStats) => void>();
  readonly #counters: MemoryCounters = { fetches: 0, evictions: 0, pinnedEvictions: 0 };
  #pinned = new Set<InstrumentId>();
  #budget: number;
  #bytes = 0;
  /** Estimated bytes of fetches in flight, reserved so a burst of loads cannot overshoot. */
  #reserved = 0;
  #recent: InstrumentId | undefined;
  #queued = false;
  #disposed = false;

  constructor(
    provider: SampleProvider,
    factory: BufferFactory,
    options: ManagedSampleSourceOptions = {},
  ) {
    this.#provider = provider;
    this.#factory = factory;
    this.#budget = checkBudget(options.budgetBytes ?? HQ_BUDGET_BYTES);
    this.#schedule = options.schedule ?? nextFrame;
  }

  peekBuffer(ref: SampleRef): AudioBuffer | undefined {
    const instrument = this.#owner.get(ref);
    if (instrument === undefined) return undefined;
    const resident = this.#residents.get(instrument);
    const buffer = resident?.buffers.get(ref);
    if (resident && instrument !== this.#recent) {
      this.#residents.delete(instrument);
      this.#residents.set(instrument, resident);
      this.#recent = instrument;
    }
    return buffer;
  }

  getBuffer(ref: SampleRef): Promise<AudioBuffer> {
    const resident = this.peekBuffer(ref);
    if (resident) return Promise.resolve(resident);
    const pending = this.#pending.get(ref);
    if (pending) return pending;
    const load = this.#load(ref).finally(() => this.#pending.delete(ref));
    this.#pending.set(ref, load);
    return load;
  }

  get budgetBytes(): number {
    return this.#budget;
  }

  /** Takes effect at once: lowering it evicts down to the new budget. */
  set budgetBytes(bytes: number) {
    this.#budget = checkBudget(bytes);
    this.#reclaim(undefined);
    this.#changed();
  }

  get counters(): MemoryCounters {
    return { ...this.#counters };
  }

  memory(): MemoryStats {
    return {
      decodedBytes: this.#bytes,
      budgetBytes: this.#budget,
      residents: [...this.#residents.keys()].sort(),
    };
  }

  /** Fires with `memory()` after any change, at most once per animation frame. */
  on(event: 'memory', handler: (stats: MemoryStats) => void): () => void {
    this.#listeners.add(handler);
    return () => this.#listeners.delete(handler);
  }

  /** Pins the song's instruments and evicts every other one now, as a song switch should. */
  switchSong(score: Score, options: Omit<PlanOptions, 'bars'> = {}): SongPlan {
    const plan = planInstruments(score, options);
    this.#pinned = new Set(plan.instruments);
    for (const instrument of [...this.#residents.keys()]) {
      if (!this.#pinned.has(instrument)) this.#evict(instrument);
    }
    this.#changed();
    return plan;
  }

  /** Decodes every sample the plan's keys can reach; rejects if any of them fails to load. */
  async preload(plan: SongPlan, regionMaps: RegionMaps): Promise<void> {
    await Promise.all(planSamples(plan, regionMaps).map((ref) => this.getBuffer(ref)));
  }

  /**
   * `switchSong`, then `preload` of the opening bars, so playback can start without a gap. A
   * sample that fails in the background warm-up is retried, and reported, on first use.
   */
  async load(score: Score, regionMaps: RegionMaps, options: LoadOptions = {}): Promise<SongPlan> {
    const { bars = DEFAULT_PRELOAD_BARS, warm = true, ...planOptions } = options;
    const plan = this.switchSong(score, planOptions);
    await this.preload(planInstruments(score, { ...planOptions, bars }), regionMaps);
    if (warm) this.#warm(planSamples(plan, regionMaps));
    return plan;
  }

  /** Resolves once no fetch is in flight. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0) await Promise.allSettled(this.#pending.values());
  }

  dispose(): void {
    this.#disposed = true;
    this.#residents.clear();
    this.#owner.clear();
    this.#listeners.clear();
    this.#bytes = 0;
  }

  #warm(refs: SampleRef[]): void {
    const missing = refs.filter((ref) => !this.#owner.has(ref));
    const bytes = missing.reduce((sum, ref) => sum + this.#provider.byteLength(ref), 0);
    if (this.#bytes + this.#reserved + bytes > this.#budget) return;
    for (const ref of missing) this.getBuffer(ref).catch(() => undefined);
  }

  async #load(ref: SampleRef): Promise<AudioBuffer> {
    const instrument = this.#provider.instrumentOf(ref);
    const estimate = Math.max(0, this.#provider.byteLength(ref));
    this.#counters.fetches += 1;
    this.#reserved += estimate;
    let buffer: AudioBuffer;
    try {
      this.#reclaim(instrument);
      buffer = decode(this.#factory, await this.#provider.fetch(ref));
    } finally {
      this.#reserved -= estimate;
    }
    if (!this.#disposed) this.#insert(instrument, ref, buffer);
    return buffer;
  }

  #insert(instrument: InstrumentId, ref: SampleRef, buffer: AudioBuffer): void {
    let resident = this.#residents.get(instrument);
    if (resident) {
      this.#residents.delete(instrument);
    } else {
      resident = { buffers: new Map(), bytes: 0 };
    }
    this.#residents.set(instrument, resident);
    this.#recent = instrument;
    const bytes = bufferBytes(buffer);
    resident.buffers.set(ref, buffer);
    resident.bytes += bytes;
    this.#bytes += bytes;
    this.#owner.set(ref, instrument);
    this.#reclaim(instrument);
    this.#changed();
  }

  /**
   * Evicts until the budget holds. `keep` is the instrument being loaded: evicting it would
   * hand back a buffer that is already gone, so the budget is exceeded only when that one
   * instrument alone is larger than it.
   */
  #reclaim(keep: InstrumentId | undefined): void {
    while (this.#bytes + this.#reserved > this.#budget) {
      const victim = this.#victim(keep);
      if (victim === undefined) return;
      this.#evict(victim);
    }
  }

  #victim(keep: InstrumentId | undefined): InstrumentId | undefined {
    let pinned: InstrumentId | undefined;
    for (const instrument of this.#residents.keys()) {
      if (instrument === keep) continue;
      if (!this.#pinned.has(instrument)) return instrument;
      pinned ??= instrument;
    }
    return pinned;
  }

  #evict(instrument: InstrumentId): void {
    const resident = this.#residents.get(instrument);
    if (!resident) return;
    for (const ref of resident.buffers.keys()) this.#owner.delete(ref);
    this.#residents.delete(instrument);
    this.#bytes -= resident.bytes;
    if (this.#recent === instrument) this.#recent = undefined;
    this.#counters.evictions += 1;
    if (this.#pinned.has(instrument)) this.#counters.pinnedEvictions += 1;
    this.#changed();
  }

  #changed(): void {
    if (this.#queued || this.#disposed) return;
    this.#queued = true;
    this.#schedule(() => {
      this.#queued = false;
      if (this.#disposed) return;
      const stats = this.memory();
      for (const listener of this.#listeners) listener(stats);
    });
  }
}
