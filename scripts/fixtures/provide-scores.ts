/**
 * Vitest global setup for the audio suite: reads every fixture of the corpus with
 * `@reprise/formats` here, in Node, and hands the scores to the browser as native documents.
 * `@reprise/audio` may not import the readers (the engines stay isolated), but its smoke test
 * still plays the real corpus.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readGp, readGp3To5 } from '@reprise/formats';
import { serializeNative } from '@reprise/model';
import type { Score } from '@reprise/model';
import type { TestProject } from 'vitest/node';

import { FIXTURES_DIR, MANIFEST_PATH } from './corpus.ts';
import type { Format, Manifest } from './corpus.ts';

/** One fixture: its native document, or why there is none. */
export interface ScoreFixture {
  path: string;
  native?: string;
  skipped?: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: ScoreFixture[];
  }
}

const READERS: Partial<Record<Format, (bytes: Uint8Array) => { score: Score }>> = {
  gp3: readGp3To5,
  gp4: readGp3To5,
  gp5: readGp3To5,
  gp: readGp,
};

function isManifest(value: unknown): value is Pick<Manifest, 'fixtures'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixtures' in value &&
    Array.isArray(value.fixtures)
  );
}

export function readScoreFixtures(): ScoreFixture[] {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!isManifest(manifest)) throw new Error('fixtures/manifest.json has no fixtures list');
  return manifest.fixtures.map(({ path, format }) => {
    const read = READERS[format];
    if (!read) return { path, skipped: `no ${format} reader yet` };
    try {
      const { score } = read(new Uint8Array(readFileSync(join(FIXTURES_DIR, path))));
      const native = new TextDecoder().decode(
        serializeNative(score, { name: 'reprise-tests', version: '0.0.0' }),
      );
      return { path, native };
    } catch (error) {
      return { path, skipped: `the reader failed: ${String(error)}` };
    }
  });
}

export default function setup(project: TestProject): void {
  project.provide('scoreFixtures', readScoreFixtures());
}
