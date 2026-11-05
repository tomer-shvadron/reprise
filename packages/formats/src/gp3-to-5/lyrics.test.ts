import { describe, expect, it } from 'vitest';

import { syllables } from './lyrics';

describe('syllables', () => {
  it('splits on spaces and after hyphens, keeping the hyphen', () => {
    expect(syllables('Hel-lo world')).toEqual(['Hel-', 'lo', 'world']);
  });

  it('leaves a beat empty for each extra space, but not around a line', () => {
    expect(syllables('  one  two ')).toEqual(['one', '', 'two']);
  });

  it('treats line breaks as word ends', () => {
    expect(syllables('one\r\ntwo\nthree')).toEqual(['one', 'two', 'three']);
  });

  it('joins words with a plus and drops comments and extenders', () => {
    expect(syllables('[Verse 1] la+la oh__')).toEqual(['la la', 'oh']);
  });

  it('is empty for an empty line', () => {
    expect(syllables('')).toEqual([]);
  });
});
