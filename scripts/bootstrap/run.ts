/**
 * Takes a fresh clone to ready for the app, the tests and `pnpm check:files`:
 *
 *   pnpm bootstrap
 *
 * Named `bootstrap` because `pnpm setup` is a pnpm built-in that edits the shell profile. It runs
 * before dependencies exist, so it imports only the standard library, and every step is safe to
 * repeat.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { exit, version } from 'node:process';

import { NEXT_COMMANDS, installSteps, minimums, versionProblems } from './steps.ts';

const ROOT = join(import.meta.dirname, '../..');

function fail(message: string): never {
  console.error(`\nbootstrap failed: ${message}`);
  exit(1);
}

function pnpmVersion(): string | undefined {
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function engines(): Record<string, string> {
  const pkg: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const value =
    typeof pkg === 'object' && pkg !== null && 'engines' in pkg ? pkg.engines : undefined;
  if (typeof value !== 'object' || value === null) fail('package.json has no engines field');
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

let count = 0;
function announce(name: string): void {
  count += 1;
  console.log(`\n[${String(count)}] ${name}`);
}

announce('Check Node and pnpm against engines');
const problems = versionProblems({ node: version, pnpm: pnpmVersion() }, minimums(engines()));
if (problems.length > 0) fail(problems.join('\n'));
console.log(`  node ${version}, pnpm ${String(pnpmVersion())}`);

for (const step of installSteps()) {
  announce(step.name);
  const [command, ...args] = step.command;
  if (command === undefined) continue;
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  if (result.status !== 0)
    fail(`\`${step.command.join(' ')}\` exited with ${String(result.status ?? result.signal)}`);
}

announce('Prepare the local-tabs folder');
const tabs = join(ROOT, 'local-tabs');
if (existsSync(tabs)) console.log('  already there');
else {
  mkdirSync(tabs);
  console.log('  created local-tabs/ (its contents are never committed)');
}

console.log('\nReady. Next:');
for (const [command, what] of NEXT_COMMANDS) console.log(`  ${command.padEnd(18)} ${what}`);
