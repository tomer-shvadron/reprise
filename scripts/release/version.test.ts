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
