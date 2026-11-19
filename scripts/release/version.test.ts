import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import { describe, expect, it } from 'vitest';

import { versionFromTag } from './version';

describe('versionFromTag', () => {
  it('reads a release', () => {
    expect(versionFromTag('v1.0.0')).toEqual({ version: '1.0.0', prerelease: false });
    expect(versionFromTag('v12.3.45')).toEqual({ version: '12.3.45', prerelease: false });
  });

  it('marks a pre-release part', () => {
    expect(versionFromTag('v1.0.0-rc.1')).toEqual({ version: '1.0.0-rc.1', prerelease: true });
    expect(versionFromTag('v2.1.0-beta')).toEqual({ version: '2.1.0-beta', prerelease: true });
  });

  it.each([
    '1.0.0',
    'v1.0',
    'vfoo',
    'v1.0.0+build',
    'v1.0.0-rc.1+build',
    'v01.0.0',
    'v1.0.0-',
    'v1.0.0-rc..1',
    'v1.0.0-rc.01',
    ' v1.0.0',
    'v1.0.0\n',
    '',
  ])('rejects %j', (tag) => {
    expect(() => versionFromTag(tag)).toThrow(/not a release tag/);
  });
});

describe('the command line', () => {
  const script = join(import.meta.dirname, 'version.ts');

  it('appends the version and prerelease flag to $GITHUB_OUTPUT', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'reprise-version-'));
    try {
      const output = join(dir, 'output');
      const run = spawnSync(process.execPath, [script, 'v1.0.0-rc.1'], {
        env: { ...process.env, GITHUB_OUTPUT: output },
        encoding: 'utf8',
      });
      expect(run.status).toBe(0);
      expect(await readFile(output, 'utf8')).toBe('version=1.0.0-rc.1\nprerelease=true\n');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('exits 1 with a message on a tag that is not a release', () => {
    const run = spawnSync(process.execPath, [script, 'vfoo'], { encoding: 'utf8' });
    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/not a release tag/);
  });
});
