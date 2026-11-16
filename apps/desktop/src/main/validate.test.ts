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

describe('window payloads', () => {
  it('takes one boolean for window:set-edited, and nothing else', () => {
    expect(parsers['window:set-edited']([true])).toEqual([true]);
    expect(parsers['window:set-edited']([false])).toEqual([false]);
    for (const bad of [['true'], [1], [undefined], [null], [], [true, false]]) {
      expect(() => parsers['window:set-edited'](bad)).toThrow(PayloadError);
    }
  });

  it('takes one boolean for window:close, and nothing else', () => {
    expect(parsers['window:close']([true])).toEqual([true]);
    expect(parsers['window:close']([false])).toEqual([false]);
    for (const bad of [[], ['yes'], [0], [true, true]]) {
      expect(() => parsers['window:close'](bad)).toThrow(PayloadError);
    }
  });
});

describe('menu:set-history', () => {
  it('takes one record of optional undo and redo names, cleaned and cut', () => {
    expect(parsers['menu:set-history']([{}])).toEqual([{}]);
    expect(parsers['menu:set-history']([{ undo: 'setNote', redo: undefined }])).toEqual([
      { undo: 'setNote' },
    ]);
    expect(parsers['menu:set-history']([{ undo: ' a\u202eb\n ', redo: '   ' }])).toEqual([
      { undo: 'ab' },
    ]);
    const [cut] = parsers['menu:set-history']([{ redo: 'x'.repeat(500) }]);
    expect(cut.redo).toHaveLength(100);
  });

  it('rejects anything else', () => {
    for (const bad of [
      [],
      [null],
      ['undo'],
      [[]],
      [{ undo: 1 }],
      [{ redo: null }],
      [{ other: 'x' }],
      [{}, {}],
    ]) {
      expect(() => parsers['menu:set-history'](bad)).toThrow(PayloadError);
    }
  });
});

describe('ranged reads and download payloads', () => {
  const hash = 'a'.repeat(64);
  const download = (overrides: Partial<Record<number, unknown>> = {}) => {
    const args: unknown[] = [
      'id-1',
      'https://example.com/pack.zip',
      'data/sounds/pack.zip',
      hash,
      1000,
    ];
    for (const [index, value] of Object.entries(overrides)) args[Number(index)] = value;
    return args;
  };

  it('takes file:read with no range or with a range', () => {
    expect(parsers['file:read'](['library/a'])).toEqual(['library/a']);
    expect(parsers['file:read'](['library/a', { offset: 4, length: 8 }])).toEqual([
      'library/a',
      { offset: 4, length: 8 },
    ]);
  });

  it.each([
    [{ offset: -1, length: 4 }],
    [{ offset: 1.5, length: 4 }],
    [{ offset: 0, length: -1 }],
    [{ offset: 0, length: 16 * 1024 * 1024 + 1 }],
    [{ offset: Number.MAX_SAFE_INTEGER + 1, length: 1 }],
    [{ offset: Number.NaN, length: 1 }],
    [{ offset: '0', length: 1 }],
    [{ offset: 0 }],
    [null],
  ])('rejects the read range %j', (range) => {
    expect(() => parsers['file:read'](['library/a', range])).toThrow(PayloadError);
  });

  it('accepts the longest read and a zero-length one', () => {
    expect(() =>
      parsers['file:read'](['library/a', { offset: 0, length: 16 * 1024 * 1024 }]),
    ).not.toThrow();
    expect(() => parsers['file:read'](['library/a', { offset: 9, length: 0 }])).not.toThrow();
  });

  it('accepts a well-formed download, lower-casing the hash', () => {
    expect(parsers['download:start'](download({ 3: hash.toUpperCase() }))).toEqual([
      'id-1',
      'https://example.com/pack.zip',
      'data/sounds/pack.zip',
      hash,
      1000,
    ]);
  });

  it.each([
    ['http', 'http://example.com/a.zip'],
    ['file', 'file:///etc/passwd'],
    ['ftp', 'ftp://example.com/a'],
    ['data', 'data:text/plain,hi'],
    ['credentials', 'https://user:pw@example.com/a.zip'],
    ['not a URL', 'example.com/a.zip'],
    ['not a string', 7],
  ])('rejects a download URL that is %s', (_label, url) => {
    expect(() => parsers['download:start'](download({ 1: url }))).toThrow(PayloadError);
  });

  it.each([
    ['library', 'library/sounds/a.zip'],
    ['data outside sounds', 'data/a.zip'],
    ['a sibling of sounds', 'data/sounds-evil/a.zip'],
    ['the sounds folder itself', 'data/sounds'],
    ['a traversal', 'data/sounds/../a.zip'],
    ['absolute', '/data/sounds/a.zip'],
    ['a backslash', 'data\\sounds\\a.zip'],
    ['an absolute picked path', '/Users/me/a.zip'],
  ])('rejects a download target that is %s', (_label, to) => {
    expect(() => parsers['download:start'](download({ 2: to }))).toThrow(PayloadError);
  });

  it('accepts nested targets under data/sounds', () => {
    expect(() =>
      parsers['download:start'](download({ 2: 'data/sounds/packs/a.zip' })),
    ).not.toThrow();
  });

  it.each([
    ['short', 'abc'],
    ['not hex', 'z'.repeat(64)],
    ['a number', 5],
  ])('rejects a hash that is %s', (_label, sha) => {
    expect(() => parsers['download:start'](download({ 3: sha }))).toThrow(PayloadError);
  });

  it.each([[0], [-5], [1.5], ['10'], [Number.POSITIVE_INFINITY]])('rejects maxBytes %j', (n) => {
    expect(() => parsers['download:start'](download({ 4: n }))).toThrow(PayloadError);
  });

  it('clamps maxBytes to the hard cap', () => {
    const [, , , , max] = parsers['download:start'](download({ 4: 100 * 1024 ** 3 }));
    expect(max).toBe(2 * 1024 ** 3);
  });

  it('rejects a missing or oversized id, and the wrong arity', () => {
    expect(() => parsers['download:start'](download({ 0: '' }))).toThrow(PayloadError);
    expect(() => parsers['download:start'](download({ 0: 'x'.repeat(65) }))).toThrow(PayloadError);
    expect(() => parsers['download:start'](download().slice(0, 4))).toThrow(PayloadError);
    expect(() => parsers['download:cancel']([])).toThrow(PayloadError);
    expect(parsers['download:cancel'](['id-1'])).toEqual(['id-1']);
  });
});
