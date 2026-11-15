import { describe, expect, it } from 'vitest';

import { parseFilters, parseRecentSongs, parsers, PayloadError } from './validate';

const filters = [{ name: 'Guitar Pro', extensions: ['gp', 'gp5'] }];

describe('payload validators', () => {
  it('accepts well-formed payloads for every channel', () => {
    const bytes = new Uint8Array([1, 2]);
    expect(parsers['file:open']([filters])).toEqual([filters]);
    expect(parsers['file:save'](['song.gp5', bytes, filters])).toEqual([
      'song.gp5',
      bytes,
      filters,
    ]);
    expect(parsers['file:read'](['/tmp/song.gp5'])).toEqual(['/tmp/song.gp5']);
    expect(parsers['file:write'](['/tmp/song.gp5', bytes])).toEqual(['/tmp/song.gp5', bytes]);
    expect(parsers['file:open-many']([filters])).toEqual([filters]);
    expect(parsers['folder:open']([filters])).toEqual([filters]);
    expect(parsers['storage:mkdir'](['library/songs'])).toEqual(['library/songs']);
    expect(parsers['storage:list'](['data'])).toEqual(['data']);
    expect(parsers['storage:move'](['library/a', 'data/b'])).toEqual(['library/a', 'data/b']);
    expect(parsers['storage:remove'](['library/a'])).toEqual(['library/a']);
    expect(parsers['menu:set-recent']([[{ id: 'a', title: 'A' }]])).toEqual([
      [{ id: 'a', title: 'A' }],
    ]);
    expect(parsers['app:library-dir']([])).toEqual([]);
    expect(parsers['app:data-dir']([])).toEqual([]);
    expect(parsers['app:print']([])).toEqual([]);
    expect(parsers['app:print']([{ pageSize: 'Letter' }])).toEqual([{ pageSize: 'Letter' }]);
  });

  it('rejects the wrong number of arguments', () => {
    expect(() => parsers['app:print']([{ pageSize: 'A4' }, 'extra'])).toThrow(PayloadError);
    expect(() => parsers['file:write'](['/tmp/a'])).toThrow(PayloadError);
  });

  it.each([['extra'], [{}], [{ pageSize: 'A3' }], [null]])(
    'rejects the print options %j',
    (value) => {
      expect(() => parsers['app:print']([value])).toThrow(PayloadError);
    },
  );

  it.each([
    ['not an array', 'gp'],
    ['a filter without a name', [{ extensions: ['gp'] }]],
    ['extensions with a dot', [{ name: 'GP', extensions: ['.gp'] }]],
    ['no extensions', [{ name: 'GP', extensions: [] }]],
    ['a non-string extension', [{ name: 'GP', extensions: [5] }]],
    ['too many filters', Array.from({ length: 17 }, () => filters[0])],
  ])('rejects filters that are %s', (_label, value) => {
    expect(() => parseFilters(value)).toThrow(PayloadError);
  });

  it.each([['relative/song.gp5'], [''], ['/tmp/a\0b'], [42]])('rejects the path %j', (path) => {
    expect(() => parsers['file:read']([path])).toThrow(PayloadError);
  });

  it.each([['../escape.gp5'], ['dir/song.gp5'], [''], [null]])(
    'rejects the suggested name %j',
    (name) => {
      expect(() => parsers['file:save']([name, new Uint8Array(), filters])).toThrow(PayloadError);
    },
  );

  it('rejects bytes that are not a Uint8Array', () => {
    expect(() => parsers['file:write'](['/tmp/a', [1, 2, 3]])).toThrow(PayloadError);
    expect(() => parsers['file:write'](['/tmp/a', 'bytes'])).toThrow(PayloadError);
  });
});

describe('storage and recent-list payloads', () => {
  it.each([['/etc'], ['library/../data'], ['C:/x'], [7]])('rejects the storage path %j', (path) => {
    expect(() => parsers['storage:mkdir']([path])).toThrow(PayloadError);
    expect(() => parsers['storage:remove']([path])).toThrow(PayloadError);
    expect(() => parsers['storage:move'](['library/a', path])).toThrow(PayloadError);
  });

  it('takes a storage path or an absolute path for file:read and file:write, nothing else', () => {
    const bytes = new Uint8Array([1]);
    expect(parsers['file:read'](['library/a.reprise'])).toEqual(['library/a.reprise']);
    expect(parsers['file:write'](['data/x', bytes])).toEqual(['data/x', bytes]);
    expect(() => parsers['file:read'](['library/../x'])).toThrow(PayloadError);
    expect(() => parsers['file:write'](['relative/path', bytes])).toThrow(PayloadError);
  });

  it.each([
    ['\\\\host\\share\\x.gp'],
    ['\\\\?\\C:\\x.gp'],
    ['\\\\.\\pipe\\x'],
    ['//host/share/x.gp'],
  ])('refuses the network or device path %j before PathAccess resolves it', (path) => {
    expect(() => parsers['file:read']([path])).toThrow(PayloadError);
    expect(() => parsers['file:write']([path, new Uint8Array()])).toThrow(PayloadError);
  });

  it('strips control and bidi characters from recent titles, with an Untitled fallback', () => {
    const parsed = parseRecentSongs([
      { id: 'a', title: 'Two\tTitles\u202eevil\u2066x\u2069\u0085' },
      { id: 'b', title: '\u202e\u0007  ' },
    ]);

    expect(parsed).toEqual([
      { id: 'a', title: 'TwoTitlesevilx' },
      { id: 'b', title: 'Untitled' },
    ]);
  });

  it('caps the recent list and the title, and refuses a malformed item', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      id: `s${String(i)}`,
      title: 'x'.repeat(500),
    }));
    const parsed = parseRecentSongs(many);

    expect(parsed).toHaveLength(10);
    expect(parsed[0]?.title).toHaveLength(200);
    expect(() => parseRecentSongs([{ id: '', title: 'A' }])).toThrow(PayloadError);
    expect(() => parseRecentSongs([{ id: 'a'.repeat(129), title: 'A' }])).toThrow(PayloadError);
    expect(() => parseRecentSongs([{ id: 'a' }])).toThrow(PayloadError);
    expect(() => parseRecentSongs('nope')).toThrow(PayloadError);
  });
});
