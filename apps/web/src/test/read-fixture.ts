import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A file of the open-licensed corpus, for the tests that run in Node or jsdom (not the browser projects). */
export function readFixture(path: string): Uint8Array {
  return new Uint8Array(readFileSync(join(import.meta.dirname, '../../../../fixtures', path)));
}
