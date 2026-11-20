/**
 * Pure parts of the pre-push hook (`.husky/pre-push`, run by `pre-push.ts`): which pushed refs
 * count, and which Vitest arguments select the tests related to the changed files.
 */

const ZERO_SHA = /^0+$/;
const TEST_SOURCE = /\.(?:ts|mts|cts|tsx)$/;
const AUDIO = /(?:^|[\\/])packages[\\/]audio[\\/]/;

export type PushedRef = { readonly localRef: string; readonly localSha: string };

/** Reads git's pre-push stdin (`<local ref> <local sha> <remote ref> <remote sha>` per line). A
 * deleted ref (all-zero local sha) pushes no commits, so it is dropped. */
export function parsePushedRefs(stdin: string): PushedRef[] {
  const refs: PushedRef[] = [];
  for (const line of stdin.split('\n')) {
    const [localRef, localSha] = line.trim().split(/\s+/);
    if (localRef === undefined || localSha === undefined || ZERO_SHA.test(localSha)) continue;
    refs.push({ localRef, localSha });
  }
  return refs;
}

/** The arguments after `vitest`, or null when no changed file is TypeScript (nothing to test).
 * The browser-mode `audio` project joins only when a file under packages/audio changed: every
 * audio test imports the model, so a model-only push would otherwise launch Chromium. */
export function vitestRelatedArgs(changed: readonly string[]): string[] | null {
  const sources = [...new Set(changed.filter((file) => TEST_SOURCE.test(file)))].sort();
  if (sources.length === 0) return null;
  const project = sources.some((file) => AUDIO.test(file)) ? [] : ['--project=!audio'];
  return ['related', '--run', '--no-fsModuleCache', ...project, ...sources];
}
