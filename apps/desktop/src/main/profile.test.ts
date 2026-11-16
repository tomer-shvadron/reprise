import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PROFILE_ENV, profilePaths } from './profile';

describe('profilePaths', () => {
  it('is undefined without the variable, or with an empty one', () => {
    expect(profilePaths({})).toBeUndefined();
    expect(profilePaths({ [PROFILE_ENV]: '' })).toBeUndefined();
  });

  it('puts userData and the library inside the named folder', () => {
    const dir = resolve('/tmp/reprise-profile');

    expect(profilePaths({ [PROFILE_ENV]: dir })).toEqual({
      userData: join(dir, 'userData'),
      library: join(dir, 'library'),
    });
  });

  it('refuses a relative path, which would depend on the launch folder', () => {
    expect(() => profilePaths({ [PROFILE_ENV]: 'profile' })).toThrow('absolute');
  });
});
