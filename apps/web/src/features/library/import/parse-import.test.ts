import { read, write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { parseImport, summarize } from './parse-import';
import { createParser } from './parser';

const song = () => score().track('guitar').track('bass').build();

describe('parseImport', () => {
  it('summarizes a gp file, writes its native and hashes the source', async () => {
    const source = (await write(song(), 'gp')).bytes;
    const outcome = await parseImport(source, 'fallback');
    if (!outcome.ok) throw new Error(outcome.message);
    const { parsed } = outcome;
    expect(parsed.format).toBe('gp');
    expect(parsed.meta.bars).toBe(song().masterBars.length);
    expect(parsed.meta.tracks).toHaveLength(2);
    expect(parsed.key).toMatch(/^[0-9a-f]{64}$/u);
    expect((await parseImport(source)).ok && (await parseImport(source))).toMatchObject({
      parsed: { key: parsed.key },
    });
    // The native holds the same track ids as itself, which a stored track session needs.
    const first = await read(parsed.native);
    expect(first.score.tracks.map((track) => track.name)).toEqual(
      parsed.meta.tracks.map((t) => t.name),
    );
  });

  it('keeps the bytes of a reprise source as its native', async () => {
    const source = (await write(song(), 'reprise')).bytes;
    const outcome = await parseImport(source);
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.parsed.format).toBe('reprise');
    expect(outcome.parsed.native).toBe(source);
  });

  it('uses the fallback title when the score has none', async () => {
    const source = (await write(song(), 'reprise')).bytes;
    const outcome = await parseImport(source, 'Stem');
    if (!outcome.ok) throw new Error(outcome.message);
    expect(outcome.parsed.meta.title).toBe(summarize(song()).title || 'Stem');
  });

  it('reports a failure for bytes that are not a song, never throws', async () => {
    expect(await parseImport(new Uint8Array([1, 2, 3]))).toEqual({
      ok: false,
      code: 'unknown-format',
      message: 'Not a Guitar Pro or Reprise file',
    });
  });
});

describe('the parser client without a Worker', () => {
  it('parses inline', async () => {
    const parser = createParser();
    const outcome = await parser.parse((await write(song(), 'reprise')).bytes);
    expect(outcome.ok).toBe(true);
    parser.dispose();
  });
});
