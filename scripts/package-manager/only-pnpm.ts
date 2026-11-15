/**
 * The root `preinstall` hook: fails an install that yarn or bun started (npm already stops at the
 * `workspace:` dependencies), so a second lockfile and a node_modules pnpm did not lay out never
 * pass silently; some managers run it after writing them, hence the message's clean-up step. It
 * runs before dependencies exist, so it imports only the standard library.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { env, exit } from 'node:process';

import { packageManagerProblem } from './user-agent.ts';

function pinned(): string | undefined {
  const pkg: unknown = JSON.parse(
    readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8'),
  );
  const value =
    typeof pkg === 'object' && pkg !== null && 'packageManager' in pkg
      ? pkg.packageManager
      : undefined;
  return typeof value === 'string' ? value : undefined;
}

const problem = packageManagerProblem(env['npm_config_user_agent'], pinned());
if (problem !== undefined) {
  console.error(`\n${problem}\n`);
  exit(1);
}
