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

export const SOUNDFONT_FATAL =
  'audio cannot run: the GM soundfont is missing; run `pnpm sounds:fetch`';

export interface Preflight {
  skips: Partial<Record<CheckId, string>>;
  /** A prerequisite CI must have; the run stops with this one line. */
  fatal?: string;
}

/** Any non-empty `CI`, including `CI=0`: the strict side is the safe one. */
export function isCi(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['CI'] ?? '') !== '';
}

/**
 * A missing soundfont is a prerequisite a developer can fix: locally it skips the audio column
 * once, on CI (which fetches it first) it stops the run.
 */
export function preflight(
  checks: readonly CheckId[],
  env: { soundfont: boolean; ci: boolean },
): Preflight {
  if (!checks.includes('audio') || env.soundfont) return { skips: {} };
  return env.ci ? { skips: {}, fatal: SOUNDFONT_FATAL } : { skips: { audio: SOUNDFONT_NOTE } };
}

/** The selected projects that still have a check to run. */
export function projectsToRun(
  selected: readonly string[],
  skips: Partial<Record<CheckId, string>>,
): string[] {
  return selected.filter((project) =>
    (PROJECT_CHECKS[project] ?? []).some((check) => skips[check] === undefined),
  );
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
