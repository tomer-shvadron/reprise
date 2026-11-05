import type { Score } from '@reprise/model';

import type { MemoryReport } from '../engine';
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
/** Fetches in flight for the background warm-up; a whole song is a queue, not a burst. */
const WARM_CONCURRENCY = 4;

/** What a `BaseAudioContext` offers for building buffers; an `OfflineAudioContext` will do. */
export interface BufferFactory {
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer;
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

export interface SongLoadOptions extends Omit<PlanOptions, 'bars'> {
  /** Bars of the playback sequence decoded before `load` resolves. */
  bars?: number;
  /**
   * Then decode the rest of the song in the background, so a later bar does not skip notes;
   * only when all of it fits, since otherwise it would evict what the opening bars need.
   */
  warm?: boolean;
}

interface Entry {
  buffer: AudioBuffer;
  bytes: number;
  owners: readonly InstrumentId[];
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
 * Accounting is per buffer, counted once however many presets share it; eviction is per
 * instrument (a half-evicted instrument would only trade a few bytes for skipped notes), least
 * recently used first, the current song's instruments last, and a buffer lives while any
 * resident instrument references it.
 */
export class ManagedSampleSource implements SampleSource {
  readonly #provider: SampleProvider;
  readonly #factory: BufferFactory;
  readonly #schedule: (callback: () => void) => void;
  /** Set order is recency: the first instrument is the least recently used. */
  readonly #residents = new Set<InstrumentId>();
  readonly #entries = new Map<SampleRef, Entry>();
  /** Every live buffer an instrument references, resident or not. */
  readonly #refsOf = new Map<InstrumentId, Set<SampleRef>>();
  readonly #pending = new Map<SampleRef, Promise<AudioBuffer>>();
  readonly #listeners = new Set<(stats: MemoryReport) => void>();
  readonly #counters: MemoryCounters = { fetches: 0, evictions: 0, pinnedEvictions: 0 };
  #pinned = new Set<InstrumentId>();
  #budget: number;
  #bytes = 0;
  /** Estimated bytes of fetches in flight, reserved so a burst of loads cannot overshoot. */
  #reserved = 0;
  #recent: SampleRef | undefined;
  /** Bumped by every song switch; a warm-up or a `load` from an earlier one stops. */
  #generation = 0;
  #warming: Promise<void> | undefined;
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
    const entry = this.#entries.get(ref);
    if (entry && ref !== this.#recent) {
      this.#recent = ref;
      for (const owner of entry.owners) if (this.#residents.has(owner)) this.#touch(owner);
    }
    return entry?.buffer;
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
    this.#reclaim();
    this.#changed();
  }

  get counters(): MemoryCounters {
    return { ...this.#counters };
  }

  /** `residents` are sorted, so a touch is not a change. */
  memory(): MemoryReport {
    return {
      decodedBytes: this.#bytes,
      budgetBytes: this.#budget,
      residents: [...this.#residents].sort(),
    };
  }

  /** Fires with `memory()` after any change, at most once per animation frame. */
  on(event: 'memory', handler: (stats: MemoryReport) => void): () => void {
    this.#listeners.add(handler);
    return () => this.#listeners.delete(handler);
  }

  /**
   * Pins the song's instruments and evicts every other one now, as a song switch should; a
   * warm-up still running for the previous song stops after what is already in flight.
   */
  switchSong(score: Score, options: Omit<PlanOptions, 'bars'> = {}): SongPlan {
    const plan = planInstruments(score, options);
    this.#generation += 1;
    this.#pinned = new Set(plan.instruments);
    for (const instrument of [...this.#residents]) {
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
  async load(
    score: Score,
    regionMaps: RegionMaps,
    options: SongLoadOptions = {},
  ): Promise<SongPlan> {
    const { bars = DEFAULT_PRELOAD_BARS, warm = true, ...planOptions } = options;
    const plan = this.switchSong(score, planOptions);
    const generation = this.#generation;
    await this.preload(planInstruments(score, { ...planOptions, bars }), regionMaps);
    if (warm && generation === this.#generation) {
      this.#warm(planSamples(plan, regionMaps), generation);
    }
    return plan;
  }

  /** Resolves once no fetch is in flight and no warm-up is queued. */
  async settled(): Promise<void> {
    while (this.#pending.size > 0 || this.#warming) {
      await Promise.allSettled([...this.#pending.values(), this.#warming]);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#generation += 1;
    this.#residents.clear();
    this.#entries.clear();
    this.#refsOf.clear();
    this.#listeners.clear();
    this.#bytes = 0;
  }

  #warm(refs: SampleRef[], generation: number): void {
    const queue = refs.filter((ref) => !this.#entries.has(ref) && !this.#pending.has(ref));
    const bytes = queue.reduce((sum, ref) => sum + this.#estimate(ref), 0);
    if (queue.length === 0 || this.#bytes + this.#reserved + bytes > this.#budget) return;
    const worker = async (): Promise<void> => {
      for (let ref = queue.shift(); ref !== undefined; ref = queue.shift()) {
        if (generation !== this.#generation) return;
        await this.getBuffer(ref).catch(() => undefined);
      }
    };
    const warming = Promise.all(Array.from({ length: WARM_CONCURRENCY }, worker)).then(() => {
      if (this.#warming === warming) this.#warming = undefined;
    });
    this.#warming = warming;
  }

  /** A bad estimate must not reach `#reserved`: one `NaN` there would disable the budget. */
  #estimate(ref: SampleRef): number {
    const bytes = this.#provider.byteLength(ref);
    return Number.isFinite(bytes) && bytes > 0 ? Math.ceil(bytes) : 0;
  }

  async #load(ref: SampleRef): Promise<AudioBuffer> {
    const owners = this.#provider.instrumentsOf(ref);
    if (owners.length === 0) {
      throw new Error(`Sample ${ref} belongs to no instrument, so it could never be evicted`);
    }
    const estimate = this.#estimate(ref);
    this.#counters.fetches += 1;
    this.#reserved += estimate;
    let buffer: AudioBuffer;
    try {
      this.#reclaim(owners);
      buffer = decode(this.#factory, await this.#provider.fetch(ref));
    } finally {
      this.#reserved -= estimate;
    }
    if (!this.#disposed) this.#insert(ref, buffer, owners);
    return buffer;
  }

  #insert(ref: SampleRef, buffer: AudioBuffer, owners: readonly InstrumentId[]): void {
    const bytes = bufferBytes(buffer);
    this.#entries.set(ref, { buffer, bytes, owners });
    this.#bytes += bytes;
    for (const owner of owners) {
      let refs = this.#refsOf.get(owner);
      if (!refs) {
        refs = new Set();
        this.#refsOf.set(owner, refs);
      }
      refs.add(ref);
      this.#touch(owner);
    }
    this.#recent = ref;
    this.#reclaim(owners);
    this.#changed();
  }

  #touch(instrument: InstrumentId): void {
    this.#residents.delete(instrument);
    this.#residents.add(instrument);
  }

  /**
   * Evicts until the budget holds. `keep` is the instruments of the sample being loaded:
   * evicting them would hand back a buffer that is already gone, so the budget is exceeded only
   * when they alone are larger than it.
   */
  #reclaim(keep: readonly InstrumentId[] = []): void {
    while (this.#bytes + this.#reserved > this.#budget) {
      const victim = this.#victim(keep);
      if (victim === undefined) return;
      this.#evict(victim);
    }
  }

  #victim(keep: readonly InstrumentId[]): InstrumentId | undefined {
    let pinned: InstrumentId | undefined;
    for (const instrument of this.#residents) {
      if (keep.includes(instrument)) continue;
      if (!this.#pinned.has(instrument)) return instrument;
      pinned ??= instrument;
    }
    return pinned;
  }

  #evict(instrument: InstrumentId): void {
    if (!this.#residents.delete(instrument)) return;
    for (const ref of this.#refsOf.get(instrument) ?? []) {
      const entry = this.#entries.get(ref);
      if (!entry || entry.owners.some((owner) => this.#residents.has(owner))) continue;
      this.#free(ref, entry);
    }
    this.#counters.evictions += 1;
    if (this.#pinned.has(instrument)) this.#counters.pinnedEvictions += 1;
    this.#changed();
  }

  #free(ref: SampleRef, entry: Entry): void {
    this.#entries.delete(ref);
    this.#bytes -= entry.bytes;
    if (this.#recent === ref) this.#recent = undefined;
    for (const owner of entry.owners) {
      const refs = this.#refsOf.get(owner);
      refs?.delete(ref);
      if (refs?.size === 0) this.#refsOf.delete(owner);
    }
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
