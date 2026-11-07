import { describe, expect, it } from 'vitest';

import { shownValue } from './redact';

describe('shownValue', () => {
  it("shows a fixture's values as they are", () => {
    expect(shownValue('Secret Song', false)).toBe('"Secret Song"');
    expect(shownValue({ name: 'Am' }, false)).toBe('{"name":"Am"}');
  });

  it('shows only numbers, booleans and absences of a local file', () => {
    expect(shownValue(3, true)).toBe('3');
    expect(shownValue(false, true)).toBe('false');
    expect(shownValue(null, true)).toBe('null');
    expect(shownValue(undefined, true)).toBe('undefined');
    expect(shownValue('Secret Song', true)).toBe('<text>');
    expect(shownValue(['Secret', 'Song'], true)).toBe('<text>');
    expect(shownValue({ name: 'Am' }, true)).toBe('<text>');
  });
});
