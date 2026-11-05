import type { SampleRef } from '../sampler/region-map';
import type { InstrumentId } from './provider-types';

/**
 * Everything `fetch` needs, carried in the ref itself so the provider keeps no table of issued
 * refs: the owning preset, the `shdr` index of each channel, the frame span after the zone's
 * address offsets, and the loop inside it. Two zones playing the same span share a ref.
 */
export interface SampleSlice {
  instrument: InstrumentId;
  /** `shdr` indices: one for mono, left then right for a merged stereo pair. */
  samples: readonly number[];
  /** Absolute frames into `smpl` for the first channel, end exclusive. */
  start: number;
  end: number;
  /** Absolute frames, as `start` and `end`. */
  loop?: { start: number; end: number };
}

export function formatSampleRef(slice: SampleSlice): SampleRef {
  const loop = slice.loop ? `/${String(slice.loop.start)}-${String(slice.loop.end)}` : '';
  return `${slice.instrument}/${slice.samples.join('+')}/${String(slice.start)}-${String(slice.end)}${loop}`;
}

function span(text: string | undefined, ref: SampleRef): { start: number; end: number } {
  const match = text === undefined ? null : /^(\d+)-(\d+)$/.exec(text);
  if (!match) throw new Error(`Not an SF2 sample ref: ${ref}`);
  return { start: Number(match[1]), end: Number(match[2]) };
}

export function parseSampleRef(ref: SampleRef): SampleSlice {
  const [instrument, samples, frames, loop, ...rest] = ref.split('/');
  if (!instrument || !samples || !/^\d+(\+\d+)?$/.test(samples) || rest.length > 0) {
    throw new Error(`Not an SF2 sample ref: ${ref}`);
  }
  return {
    instrument,
    samples: samples.split('+').map(Number),
    ...span(frames, ref),
    ...(loop !== undefined && { loop: span(loop, ref) }),
  };
}
