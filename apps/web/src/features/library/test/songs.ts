import { write } from '@reprise/formats';
import { score } from '@reprise/model/testing';

import type { ImportSource } from '../import/sources';

/** A `.reprise` file with a distinct title (and so distinct bytes), for importing in tests. */
export async function songBytes(title: string, format: 'reprise' | 'gp' = 'reprise') {
  const built = score().title(title).artist('Artist').track('guitar').track('bass').build();
  return (await write(built, format)).bytes;
}

/** A source over `bytes`; `reads` counts how often it was read. */
export function sourceOf(name: string, bytes: Uint8Array, reads?: { count: number }): ImportSource {
  return {
    name,
    size: bytes.byteLength,
    read: () => {
      if (reads) reads.count += 1;
      return Promise.resolve(bytes.slice());
    },
  };
}
