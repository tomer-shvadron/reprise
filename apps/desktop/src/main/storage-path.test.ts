import { describe, expect, it } from 'vitest';

import { isStoragePath, parseStoragePath, StoragePathError } from './storage-path';

// Keep this table in step with the browser twin's, in apps/web/src/platform/browser-storage.test.ts.
describe('parseStoragePath', () => {
  it('splits a path under either root', () => {
    expect(parseStoragePath('library/songs/a.reprise')).toEqual({
      root: 'library',
      segments: ['songs', 'a.reprise'],
    });
    expect(parseStoragePath('data')).toEqual({ root: 'data', segments: [] });
    expect(parseStoragePath('library/Aux1/COM10/my.CONfig/com.txt')).toMatchObject({
      root: 'library',
    });
  });

  it.each([
    [42],
    [undefined],
    [null],
    [{}],
    [''],
    ['/library/a'],
    ['/etc/passwd'],
    ['C:/Windows'],
    ['C:\\Windows'],
    ['library\\a'],
    ['library/../data/a'],
    ['library/..'],
    ['..'],
    ['../library'],
    ['library/./a'],
    ['library/.'],
    ['library//a'],
    ['library/a/'],
    ['library/a\0b'],
    ['library/a:stream'],
    ['library/a:b'],
    ['elsewhere/a'],
    ['other/a'],
    ['Library/a'],
    ['DATA/a'],
    [`library/${'x'.repeat(256)}`],
    [`library/${'a/'.repeat(600)}a`],
    // Windows-hostile names
    ['library/songs.'],
    ['library/a '],
    ['library/...'],
    ['library/CON'],
    ['library/con'],
    ['library/nul.txt'],
    ['library/Prn.tar.gz'],
    ['library/AUX'],
    ['library/COM1'],
    ['library/lpt9.gp'],
    ['library/CONIN$'],
    ['library/conout$.txt'],
    ['library/COM\u00b9'],
    ['library/lpt\u00b2.gp'],
    ['library/COM\u00b3.tar.gz'],
    ['library/a<b'],
    ['library/a>b'],
    ['library/a"b'],
    ['library/a|b'],
    ['library/a?b'],
    ['library/a*b'],
    ['library/a\tb'],
    ['library/a\u001fb'],
  ])('rejects %j', (value) => {
    expect(() => parseStoragePath(value)).toThrow(StoragePathError);
  });
});

describe('isStoragePath', () => {
  it.each([['library'], ['data'], ['library/a'], ['data/x/y']])(
    'takes %j for a storage path',
    (value) => {
      expect(isStoragePath(value)).toBe(true);
    },
  );

  it.each([['/library/a'], ['C:/library'], ['libraryx/a'], ['Library/a'], ['/Users/me/a.gp']])(
    'takes %j for an absolute or other path',
    (value) => {
      expect(isStoragePath(value)).toBe(false);
    },
  );
});
