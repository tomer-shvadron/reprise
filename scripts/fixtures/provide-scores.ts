/**
 * Vitest global setup for the audio suite: reads every fixture of the corpus with
 * `@reprise/formats` here, in Node, and hands the scores to the browser as native documents.
 * `@reprise/audio` may not import the readers (the engines stay isolated), but its smoke test
 * still plays the real corpus.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { read } from '@reprise/formats';
import { serializeNative } from '@reprise/model';
import type { TestProject } from 'vitest/node';

import { FIXTURES_DIR, MANIFEST_PATH } from './corpus.ts';
import type { Manifest } from './corpus.ts';

/** One fixture, as a native document. */
export interface ScoreFixture {
  path: string;
  native: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    scoreFixtures: ScoreFixture[];
  }
}

function isManifest(value: unknown): value is Pick<Manifest, 'fixtures'> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixtures' in value &&
    Array.isArray(value.fixtures)
  );
}

/**
 * Every fixture through the app's own dispatcher. A reader error fails the setup, naming each
 * fixture, so a formats regression cannot quietly shrink the smoke test.
 */
export async function readScoreFixtures(): Promise<ScoreFixture[]> {
  const manifest: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!isManifest(manifest)) throw new Error('fixtures/manifest.json has no fixtures list');
  const results = await Promise.allSettled(
    manifest.fixtures.map(async ({ path, format }) => {
      const { score } = await read(new Uint8Array(readFileSync(join(FIXTURES_DIR, path))), format);
      const native = new TextDecoder().decode(
        serializeNative(score, { name: 'reprise-tests', version: '0.0.0' }),
      );
      return { path, native };
    }),
  );
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${manifest.fixtures[index]?.path ?? '?'}: ${String(result.reason)}`]
      : [],
  );
  if (failures.length > 0) {
    throw new Error(`The fixture corpus does not read:\n${failures.join('\n')}`);
  }
  return results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

export default async function setup(project: TestProject): Promise<void> {
  project.provide('scoreFixtures', await readScoreFixtures());
}
