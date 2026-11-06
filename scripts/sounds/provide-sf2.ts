/**
 * Vitest global setup for `audio-node`: reads the synthetic bank here, since `@reprise/audio` is
 * typed without Node's modules, and provides its bytes to the Node-only SF2 test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    syntheticSf2: Uint8Array;
  }
}

const SYNTHETIC = join(
  import.meta.dirname,
  '..',
  '..',
  'packages/audio/test-fixtures/synthetic.sf2',
);

export default function setup(project: TestProject): void {
  project.provide('syntheticSf2', new Uint8Array(readFileSync(SYNTHETIC)));
}
