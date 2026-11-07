import { describe, expect, it } from 'vitest';

import { parseFilters, parsers, PayloadError } from './validate';

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
