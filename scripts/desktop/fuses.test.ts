import { FuseV1Options } from '@electron/fuses';
import { describe, expect, it } from 'vitest';

import {
  EXPECTED_FUSES,
  FUSE_DISABLED,
  FUSE_ENABLED,
  executableIn,
  fuseMismatches,
  fuseTarget,
  unpackedAppDir,
} from './fuses';

const on = FUSE_ENABLED;
const off = FUSE_DISABLED;
const shipped = {
  [FuseV1Options.RunAsNode]: off,
  [FuseV1Options.EnableCookieEncryption]: off,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: off,
  [FuseV1Options.EnableNodeCliInspectArguments]: off,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: off,
  [FuseV1Options.OnlyLoadAppFromAsar]: on,
  [FuseV1Options.GrantFileProtocolExtraPrivileges]: off,
};

describe('fuseMismatches', () => {
  it('accepts the wire the app ships with', () => {
    expect(fuseMismatches(shipped)).toEqual([]);
  });

  it('names each fuse that is wrong', () => {
    const wire = {
      ...shipped,
      [FuseV1Options.RunAsNode]: on,
      [FuseV1Options.OnlyLoadAppFromAsar]: off,
    };
    expect(fuseMismatches(wire)).toEqual([
      'RunAsNode is on, expected off',
      'OnlyLoadAppFromAsar is off, expected on',
    ]);
  });

  it('treats a missing fuse as wrong', () => {
    expect(fuseMismatches({})).toHaveLength(EXPECTED_FUSES.length);
  });
});

describe('app paths', () => {
  it('finds the unpacked app and its executable per platform', () => {
    expect(unpackedAppDir('/r', 'darwin', 'arm64')).toBe('/r/mac-arm64');
    expect(unpackedAppDir('/r', 'darwin', 'x64')).toBe('/r/mac');
    expect(unpackedAppDir('/r', 'win32', 'x64')).toBe('/r/win-unpacked');
    expect(() => unpackedAppDir('/r', 'linux', 'x64')).toThrow();
    expect(executableIn('/a', 'darwin')).toBe('/a/Reprise.app/Contents/MacOS/Reprise');
    expect(fuseTarget('/a', 'darwin')).toBe('/a/Reprise.app');
    expect(fuseTarget('/a', 'win32')).toBe('/a/Reprise.exe');
  });
});
