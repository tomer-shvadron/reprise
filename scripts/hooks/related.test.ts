import { describe, expect, it } from 'vitest';

import { parsePushedRefs, vitestRelatedArgs } from './related.ts';

const SHA = 'a'.repeat(40);
const ZERO = '0'.repeat(40);

describe('parsePushedRefs', () => {
  it('reads a new branch, whose remote sha is all zeros', () => {
    expect(parsePushedRefs(`refs/heads/x ${SHA} refs/heads/x ${ZERO}\n`)).toEqual([
      { localRef: 'refs/heads/x', localSha: SHA },
    ]);
  });

  it('drops a deleted ref and blank lines', () => {
    expect(parsePushedRefs(`(delete) ${ZERO} refs/heads/x ${SHA}\n\n`)).toEqual([]);
  });
});

describe('vitestRelatedArgs', () => {
  it('returns null when nothing TypeScript changed', () => {
    expect(vitestRelatedArgs(['README.md', 'package.json'])).toBeNull();
    expect(vitestRelatedArgs([])).toBeNull();
  });

  it('leaves the audio project out unless an audio file changed', () => {
    expect(vitestRelatedArgs(['packages/model/src/a.ts'])).toEqual([
      'related',
      '--run',
      '--no-fsModuleCache',
      '--project=!audio',
      'packages/model/src/a.ts',
    ]);
    expect(vitestRelatedArgs(['packages/audio/src/a.ts'])).not.toContain('--project=!audio');
  });

  it('dedupes and ignores non-TypeScript files', () => {
    const args = vitestRelatedArgs(['b.ts', 'a.tsx', 'b.ts', 'c.md']);
    expect(args?.slice(-2)).toEqual(['a.tsx', 'b.ts']);
  });
});
