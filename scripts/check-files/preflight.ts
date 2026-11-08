import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { ROOT_DIR } from './files.ts';
import type { CheckId } from './meta.ts';

export const SOUNDFONT_PATH = join(ROOT_DIR, 'apps/web/public/sounds/gm/GeneralUser-GS.sf2');

export const PROJECT_CHECKS: Readonly<Record<string, readonly CheckId[]>> = {
  formats: ['read', 'oracle', 'order', 'tempo'],
  layout: ['layout'],
  audio: ['audio'],
};

export function checksFor(only: readonly string[]): CheckId[] {
  const projects = only.length === 0 ? Object.keys(PROJECT_CHECKS) : only;
  return projects.flatMap((project) => PROJECT_CHECKS[project] ?? []);
}
export const SKIPS_ENV = 'REPRISE_CHECK_SKIPS';

export const SOUNDFONT_NOTE = 'audio skipped: run `pnpm sounds:fetch`';

/**
 * The checks to leave unrun, with why. A missing soundfont is a prerequisite a developer can fix,
 * so locally it skips the audio column once; on CI it is left to the check, which fails each file.
 */
export function preflight(
  checks: readonly CheckId[],
  env: { soundfont: boolean; ci: boolean },
): Partial<Record<CheckId, string>> {
  if (!checks.includes('audio') || env.soundfont || env.ci) return {};
  return { audio: SOUNDFONT_NOTE };
}

export function soundfontPresent(): boolean {
  return existsSync(SOUNDFONT_PATH);
}

export function skipsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): Partial<Record<CheckId, string>> {
  const raw = env[SKIPS_ENV];
  if (raw === undefined || raw === '') return {};
  const parsed: unknown = JSON.parse(raw);
  const skips: Partial<Record<CheckId, string>> = {};
  if (typeof parsed === 'object' && parsed !== null && 'audio' in parsed) {
    if (typeof parsed.audio === 'string') skips.audio = parsed.audio;
  }
  return skips;
}
