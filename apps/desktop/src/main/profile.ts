import { isAbsolute, join } from 'node:path';

export const PROFILE_ENV = 'REPRISE_PROFILE_DIR';

export interface ProfilePaths {
  userData: string;
  library: string;
}

/**
 * Where the app keeps its state when `REPRISE_PROFILE_DIR` names a folder: Chromium's profile and
 * the library both move inside it, so a run (the smoke test) never touches the user's own
 * `userData` or `~/Music/Reprise`. Undefined without the variable. Only the environment of the
 * process that launches the app can set it; the renderer has no way to.
 */
export function profilePaths(
  env: Readonly<Record<string, string | undefined>>,
): ProfilePaths | undefined {
  const dir = env[PROFILE_ENV];
  if (dir === undefined || dir === '') return undefined;
  if (!isAbsolute(dir) || dir.includes('\0')) {
    throw new Error(`${PROFILE_ENV} must be an absolute path`);
  }
  return { userData: join(dir, 'userData'), library: join(dir, 'library') };
}
