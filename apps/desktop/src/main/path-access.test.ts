import { describe, expect, it } from 'vitest';

import { PathAccess } from './path-access';

describe('PathAccess', () => {
  const access = new PathAccess(['/Users/me/Music/Reprise', '/Users/me/Library/Reprise']);

  it('allows files under a root', () => {
    expect(access.allows('/Users/me/Music/Reprise/song.gp5')).toBe(true);
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
