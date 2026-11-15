import { read } from '@reprise/formats';
import { describe, expect, it } from 'vitest';

import { fetchFixture, fixtureUrl } from '@/test/assets';

import { createParser } from './parser';

interface ManifestEntry {
  path: string;
  format: string;
  bars: number;
  tracks: number;
}

async function manifest(): Promise<ManifestEntry[]> {
  const response = await fetch(fixtureUrl('manifest.json'));
  const body = (await response.json()) as { fixtures: ManifestEntry[] };
  return body.fixtures;
}

describe('the parse worker', () => {
  it('parses every fixture off the main thread and transfers the native back', async () => {
    const parser = createParser();
    try {
      for (const entry of await manifest()) {
        const bytes = await fetchFixture(entry.path);
        const outcome = await parser.parse(bytes, 'fallback');
        // The input was transferred to the worker, so this thread's view of it is detached; an
        // inline parse would have left it intact.
        expect(bytes.byteLength, entry.path).toBe(0);
        if (!outcome.ok) throw new Error(`${entry.path}: ${outcome.message}`);
        const { parsed } = outcome;
        expect(parsed.format, entry.path).toBe(entry.format);
        expect(parsed.meta.bars, entry.path).toBe(entry.bars);
        expect(parsed.meta.tracks, entry.path).toHaveLength(entry.tracks);
        expect(parsed.key).toMatch(/^[0-9a-f]{64}$/u);
        // A native that reads back is what a stored track session is keyed to.
        const back = await read(parsed.native);
        expect(back.score.tracks, entry.path).toHaveLength(entry.tracks);
      }
    } finally {
      parser.dispose();
    }
  }, 120_000);

  it('reports a file that is not a song as a failed outcome', async () => {
    const parser = createParser();
    try {
      const outcome = await parser.parse(new Uint8Array([9, 9, 9]));
      expect(outcome).toMatchObject({ ok: false, code: 'unknown-format' });
    } finally {
      parser.dispose();
    }
  });

  it('rejects pending parses when disposed', async () => {
    const parser = createParser();
    const pending = parser.parse(await fetchFixture((await manifest())[0]?.path ?? ''));
    parser.dispose();
    await expect(pending).rejects.toThrow();
  });
});
