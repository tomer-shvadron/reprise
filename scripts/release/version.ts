/**
 * The version a release tag names. `v1.0.0` and `v1.0.0-rc.1` are accepted, nothing else: no bare
 * `1.0.0`, no partial `v1.0` and no build metadata (`+build`), so a stray tag cannot ship an
 * installer with an odd version.
 *
 *   node scripts/release/version.ts v1.0.0-rc.1   # writes version= and prerelease= to $GITHUB_OUTPUT
 */
import { appendFileSync } from 'node:fs';
import process, { argv, env } from 'node:process';

export interface TagVersion {
  /** The semver without the leading `v`. */
  version: string;
  /** Whether the version has a pre-release part, which makes the GitHub release a prerelease. */
  prerelease: boolean;
}

const NUMBER = '(?:0|[1-9]\\d*)';
// Dot-separated pre-release identifiers: numeric ones without leading zeros, others free-form.
const IDENTIFIER = `(?:${NUMBER}|\\d*[A-Za-z-][0-9A-Za-z-]*)`;
const TAG = new RegExp(
  `^v(${NUMBER}\\.${NUMBER}\\.${NUMBER})(?:-(${IDENTIFIER}(?:\\.${IDENTIFIER})*))?$`,
);

export function versionFromTag(tag: string): TagVersion {
  const match = TAG.exec(tag);
  if (match === null) {
    throw new Error(
      `"${tag}" is not a release tag: expected v<major>.<minor>.<patch>[-<prerelease>]`,
    );
  }
  return { version: tag.slice(1), prerelease: match[2] !== undefined };
}

if (import.meta.main) {
  try {
    const { version, prerelease } = versionFromTag(argv[2] ?? '');
    const lines = `version=${version}\nprerelease=${String(prerelease)}\n`;
    const output = env['GITHUB_OUTPUT'];
    if (output === undefined || output === '') process.stdout.write(lines);
    else appendFileSync(output, lines);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
