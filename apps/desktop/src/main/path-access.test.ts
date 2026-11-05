import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PathAccess } from './path-access';

describe('PathAccess', () => {
  const access = new PathAccess(['/Users/me/Music/Reprise', '/Users/me/Library/Reprise']);

  it('allows files under a root', () => {
    expect(access.allows('/Users/me/Music/Reprise/song.gp5')).toBe(true);
    expect(access.allows('/Users/me/Music/Reprise/..dotfile')).toBe(true);
    expect(access.allows('/Users/me/Library/Reprise/packs/piano/a.flac')).toBe(true);
  });

  it('rejects the root itself, siblings and escapes', () => {
    expect(access.allows('/Users/me/Music/Reprise')).toBe(false);
    expect(access.allows('/Users/me/Music/Reprise-other/song.gp5')).toBe(false);
    expect(access.allows('/Users/me/Music/Reprise/../secret.txt')).toBe(false);
    expect(access.allows('/etc/hosts')).toBe(false);
  });

  it('allows a granted file and nothing next to it', () => {
    const granted = new PathAccess([]);
    granted.grant('/Users/me/Desktop/song.gp5');

    expect(granted.allows('/Users/me/Desktop/./song.gp5')).toBe(true);
    expect(granted.allows('/Users/me/Desktop/other.gp5')).toBe(false);
  });
});

describe('PathAccess with symlinks on disk', () => {
  let base: string;
  let library: string;
  let outside: string;
  let alias: string;

  beforeAll(() => {
    base = mkdtempSync(join(tmpdir(), 'reprise-access-'));
    library = join(base, 'library');
    outside = join(base, 'outside');
    alias = join(base, 'alias');
    mkdirSync(library);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(library, 'link.gp5'));
    symlinkSync(outside, join(library, 'linked-dir'));
    symlinkSync(library, alias);
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it('judges a symlink by where it points', () => {
    const access = new PathAccess([library]);
    expect(access.allows(join(library, 'link.gp5'))).toBe(false);
    expect(access.allows(join(library, 'linked-dir', 'secret.txt'))).toBe(false);
    expect(access.allows(join(library, 'linked-dir', 'new.gp5'))).toBe(false);
  });

  it('allows a file that does not exist yet, however deep', () => {
    const access = new PathAccess([library]);
    expect(access.allows(join(library, 'new.gp5'))).toBe(true);
    expect(access.allows(join(library, 'sub', 'dir', 'new.gp5'))).toBe(true);
  });

  it('treats a symlinked root and its target as one place', () => {
    const access = new PathAccess([alias]);
    expect(access.allows(join(library, 'song.gp5'))).toBe(true);
    expect(access.allows(join(alias, 'song.gp5'))).toBe(true);

    const granted = new PathAccess([]);
    granted.grant(join(alias, 'song.gp5'));
    expect(granted.allows(join(library, 'song.gp5'))).toBe(true);
  });
});
