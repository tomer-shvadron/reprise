/**
 * `pnpm sfz:check <dir>`: loads every SFZ file under a directory (a pack downloaded into the
 * gitignored `local-sounds/`) and prints what the loader found: regions, sample files, formats,
 * rates, and the opcodes it dropped or does not play. Exits 1 when a file loses data the loader
 * should not lose, a sample file is missing or a sample header is not WAV, FLAC or Ogg. Plain
 * Node cannot import the workspace packages, so this drives Vitest, as `pnpm check:files` does.
 */
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { exit } from 'node:process';
import { fileURLToPath } from 'node:url';

import { startVitest } from 'vitest/node';

import { DIR_ENV } from './provide-sfz-pack.ts';

const [directory, ...extra] = process.argv.slice(2).filter((arg) => arg !== '--');
if (directory === undefined || extra.length > 0) {
  console.error('Usage: pnpm sfz:check <directory of an SFZ pack, e.g. local-sounds/swagbass>');
  exit(2);
}
const root = resolve(directory);
if (!existsSync(root) || !statSync(root).isDirectory()) {
  console.error(`Not a directory: ${directory}`);
  exit(2);
}

process.env[DIR_ENV] = root;
const vitest = await startVitest([], {
  config: fileURLToPath(new URL('vitest.config.ts', import.meta.url)),
  watch: false,
  project: ['check-sfz'],
});
const failed =
  vitest.state.getCountOfFailedTests() > 0 || vitest.state.getUnhandledErrors().length > 0;
await vitest.close();
exit(failed ? 1 : 0);
