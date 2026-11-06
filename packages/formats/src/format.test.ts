import { describe, expect, it } from 'vitest';

import { formatOfExtension } from './format';

describe('formatOfExtension', () => {
  it.each([
    ['song.gp5', 'gp5'],
    ['Song.GP5', 'gp5'],
    ['/a/b.c/song.gpx', 'gpx'],
    ['C:\\tabs\\x.y\\song.gp3', 'gp3'],
    ['song.reprise', 'reprise'],
    ['archive.tar.gp', 'gp'],
  ])('reads %s as %s', (name, format) => {
    expect(formatOfExtension(name)).toBe(format);
  });

  it.each(['song', 'song.', 'song.txt', 'song.gp6', '/a/b.gp5/song'])(
    'finds none in %s',
    (name) => {
      expect(formatOfExtension(name)).toBeUndefined();
    },
  );
});
