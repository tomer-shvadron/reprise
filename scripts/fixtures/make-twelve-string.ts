/**
 * Derives `fixtures/gp5/twelve-string.gp5` from alphaTab's `effects.gp5` (already in
 * `fixtures/gp5/`, MPL-2.0): the only change is the first track's 12-string flag, bit 0x02 of its
 * flags byte. Guitar Pro itself wrote none of this file's 12-string-ness, so the fixture proves
 * only that Reprise reads the flag the way the format documents describe it (#348); it is
 * replaced by a file the owner saves in Guitar Pro 8 when one arrives.
 *
 *   node scripts/fixtures/make-twelve-string.ts           write the fixture
 *   node scripts/fixtures/make-twelve-string.ts --check   exit 1 if it is stale
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { argv, exit } from 'node:process';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures', 'gp5');
const SOURCE = join(FIXTURES, 'effects.gp5');
const TARGET = join(FIXTURES, 'twelve-string.gp5');
const TWELVE_STRING_FLAG = 0x02;

/** A track record opens with a flags byte and a 41-byte name field, then the int string count. */
const NAME_FIELD = 41;
/** The string count 6 and E standard (64 59 55 50 45 40), as 32-bit little-endian ints. */
const SIX_STRINGS = Uint8Array.from(
  [6, 64, 59, 55, 50, 45, 40].flatMap((value) => [value, 0, 0, 0]),
);

function findFirstTrackFlags(bytes: Uint8Array): number {
  const matches: number[] = [];
  for (let start = NAME_FIELD + 1; start + SIX_STRINGS.length <= bytes.length; start += 1) {
    if (SIX_STRINGS.every((value, offset) => bytes[start + offset] === value)) matches.push(start);
  }
  const [first] = matches;
  if (matches.length !== 1 || first === undefined) {
    throw new Error(
      `expected one six-string track record in ${SOURCE}, found ${String(matches.length)}`,
    );
  }
  return first - NAME_FIELD - 1;
}

async function main(): Promise<void> {
  const bytes = new Uint8Array(await readFile(SOURCE));
  const at = findFirstTrackFlags(bytes);
  bytes[at] = (bytes[at] ?? 0) | TWELVE_STRING_FLAG;
  if (argv.includes('--check')) {
    const current = new Uint8Array(await readFile(TARGET).catch(() => new Uint8Array()));
    const same = current.length === bytes.length && current.every((b, i) => b === bytes[i]);
    if (!same) {
      console.error(
        'fixtures/gp5/twelve-string.gp5 is stale: run node scripts/fixtures/make-twelve-string.ts',
      );
      exit(1);
    }
    return;
  }
  await writeFile(TARGET, bytes);
}

await main();
