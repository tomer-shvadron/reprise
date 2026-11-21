import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { read, write } from '@reprise/formats';
import { score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { parseImport } from './parse-import';
import { createParser } from './parser';

// The project root is the working directory of every Vitest run; jsdom tests have no file URLs.
const fetchFixture = (path: string) =>
  Promise.resolve(new Uint8Array(readFileSync(join(process.cwd(), 'fixtures', path))));

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
    const again = await parseImport(source);
    expect(again.ok && again.parsed.key).toBe(parsed.key);
    // A stored track session names track ids, so reading the stored native must always give
    // the same ones.
    const ids = async () => (await read(parsed.native)).score.tracks.map((track) => track.id);
    expect(await ids()).toEqual(await ids());
  });

  it('applies the notation defaults to a file that chooses none, and never to one that does', async () => {
    const defaults = { strings: 'standard', vocals: 'standard' } as const;
    const notations = async (path: string) => {
      const outcome = await parseImport(await fetchFixture(path), '', defaults);
      if (!outcome.ok) throw new Error(outcome.message);
      return (await read(outcome.parsed.native)).score.tracks.map(
        (track) => track.display.notation,
      );
    };
    expect(new Set(await notations('gp4/notes.gp4'))).toEqual(new Set(['standard']));
    const plain = await read(await fetchFixture('gp5/staves.gp5'));
    expect(await notations('gp5/staves.gp5')).toEqual(
      plain.score.tracks.map((track) => track.display.notation),
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
    expect(outcome.parsed.meta.title).toBe('Stem');
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
