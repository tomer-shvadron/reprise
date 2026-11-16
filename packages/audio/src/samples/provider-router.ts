import type { SampleRef } from '../sampler/region-map';
import type { SfzPack } from '../sfz/pack';
import type { InstrumentId, RawSample, SampleProvider } from './types';

const PACK_REF = 'sfz:';
const PACK_INSTRUMENT = 'sfz:';

/** The memory manager's id for one SFZ file of an installed pack: `sfz:<packId>:<path>`. */
export function packInstrumentId(packId: string, path: string): InstrumentId {
  return `${PACK_INSTRUMENT}${packId}:${path}`;
}

/** The pack and SFZ path an instrument id names; `undefined` for a GM id. */
export function parsePackInstrumentId(
  id: InstrumentId,
): { packId: string; path: string } | undefined {
  if (!id.startsWith(PACK_INSTRUMENT)) return undefined;
  const rest = id.slice(PACK_INSTRUMENT.length);
  const colon = rest.indexOf(':');
  if (colon <= 0) return undefined;
  return { packId: rest.slice(0, colon), path: rest.slice(colon + 1) };
}

/**
 * The SFZ paths of a pack that hold decoded samples, from the memory report's residents: what a
 * memory screen (WP-094) names under the pack.
 */
export function packInstrumentsOf(residents: readonly InstrumentId[], packId: string): string[] {
  const paths: string[] = [];
  for (const id of residents) {
    const parsed = parsePackInstrumentId(id);
    if (parsed?.packId === packId) paths.push(parsed.path);
  }
  return paths;
}

/** The pack id of a pack sample ref, `sfz:<packId>/<path>`. */
function packOf(ref: SampleRef): string | undefined {
  if (!ref.startsWith(PACK_REF)) return undefined;
  const slash = ref.indexOf('/', PACK_REF.length);
  return slash === -1 ? undefined : ref.slice(PACK_REF.length, slash);
}

/**
 * The one provider behind the memory manager: a ref of an SFZ pack goes to that pack, anything
 * else to the soundfont, so accounting, eviction and pinning cover the GM bank and every pack
 * together. A ref of a pack the router does not hold rejects `fetch` and has no owners, so it
 * is never loaded.
 */
export class ProviderRouter implements SampleProvider {
  readonly #gm: SampleProvider;
  #packs: ReadonlyMap<string, SfzPack> = new Map();

  constructor(gm: SampleProvider) {
    this.#gm = gm;
  }

  /** Replaces the packs the router holds; one that is left out can no longer be fetched from. */
  setPacks(packs: ReadonlyMap<string, SfzPack>): void {
    this.#packs = packs;
  }

  #route(ref: SampleRef): SampleProvider | undefined {
    const id = packOf(ref);
    if (id === undefined) return ref.startsWith(PACK_REF) ? undefined : this.#gm;
    return this.#packs.get(id);
  }

  instrumentsOf(ref: SampleRef): InstrumentId[] {
    return this.#route(ref)?.instrumentsOf(ref) ?? [];
  }

  byteLength(ref: SampleRef): number {
    return this.#route(ref)?.byteLength(ref) ?? Number.NaN;
  }

  fetch(ref: SampleRef): Promise<RawSample> {
    const provider = this.#route(ref);
    return provider
      ? provider.fetch(ref)
      : Promise.reject(new Error(`Sample ${ref} belongs to no installed pack`));
  }
}
