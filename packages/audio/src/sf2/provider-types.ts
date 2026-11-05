import type { SampleRef } from '../sampler/region-map';

// A copy of the seam WP-034 defines in `src/samples/types.ts`; the two merge into that file.

export type InstrumentId = string; // e.g. 'gm:0:25' = bank:program, 'gm:drums:0' for kits

export interface RawSample {
  sampleRate: number;
  channels: Float32Array[];
  loop?: { start: number; end: number };
  byteLength: number;
}

export interface SampleProvider {
  /** Which instrument a sample belongs to, for whole-instrument eviction. */
  instrumentOf(ref: SampleRef): InstrumentId;
  /** Raw PCM, decoded by the manager into an AudioBuffer. */
  fetch(ref: SampleRef): Promise<RawSample>;
  /** Decoded size estimate for budgeting before fetch. */
  byteLength(ref: SampleRef): number;
}
