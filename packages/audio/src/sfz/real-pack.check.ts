/**
 * `pnpm sfz:check <dir>`: loads every SFZ file of a pack on disk and verifies its sample files.
 * Runs only under that script, never in `pnpm test`; the logic lives in `check-pack.ts`, which a
 * `*.node.test.ts` covers.
 */
import { describe, expect, inject, it } from 'vitest';

import { checkPack, formatPackReport } from './check-pack';
import type { PackSnapshot } from './check-pack';

declare module 'vitest' {
  export interface ProvidedContext {
    sfzPack: PackSnapshot;
    sfzPackName: string;
  }
}

describe('SFZ pack', () => {
  it('loads cleanly and every sample file exists with a decodable header', async () => {
    const results = await checkPack(inject('sfzPack'));
    console.info(`\n${inject('sfzPackName')}\n${formatPackReport(results)}\n`);
    expect(results.length, 'no .sfz files under the directory').toBeGreaterThan(0);
    expect(results.filter((result) => result.errors.length > 0).map((r) => r.path)).toEqual([]);
  });
});
