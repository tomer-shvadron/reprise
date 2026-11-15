import { describe, expect, it } from 'vitest';

import { parseStoragePath } from '@/platform/storage-path';

import { safeName } from './safe-name';

describe('safeName', () => {
  it.each([
    ['plain.gp5', 'plain.gp5'],
    ['a/b\\c.gp5', 'a_b_c.gp5'],
    ['Song: Part 2?.gp4', 'Song_ Part 2_.gp4'],
    ['tab\u0007bell.gp3', 'tab_bell.gp3'],
    ['CON', '_CON'],
    ['con.gp5', '_con.gp5'],
    ['LPT1.txt', '_LPT1.txt'],
    ['song.gp5. ', 'song.gp5'],
    ['.hidden.gp5', '_hidden.gp5'],
    ['', 'song'],
    ['...', 'song'],
  ])('turns %j into %j', (name, expected) => {
    expect(safeName(name)).toBe(expected);
  });

  it('caps a long name and keeps its extension', () => {
    const safe = safeName(`${'a'.repeat(300)}.gp5`);
    expect(safe.length).toBeLessThanOrEqual(120);
    expect(safe.endsWith('.gp5')).toBe(true);
  });

  it('always makes a segment the storage contract accepts', () => {
    for (const name of ['CON.gp5', 'a:b', 'x'.repeat(400), 'dots...', 'NUL ', '\u0000\u0001']) {
      expect(() => parseStoragePath(`library/originals/id/${safeName(name)}`)).not.toThrow();
    }
  });
});
