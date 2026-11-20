import { describe, expect, it } from 'vitest';

import { parseQuery } from './query';

describe('parseQuery', () => {
  it.each([
    ['#chorus', 'sections', 'chorus'],
    ['@ lead ', 'tracks', 'lead'],
    ['/blue', 'songs', 'blue'],
    ['>', 'commands', ''],
    ['>12', 'commands', '12'],
    ['  #a', 'sections', 'a'],
    ['012', 'bar', '012'],
    ['12', 'bar', '12'],
    ['12a', 'commands', '12a'],
    ['1234567', 'commands', '1234567'],
    ['', 'commands', ''],
    ['play', 'commands', 'play'],
  ])('reads %j as %s', (input, mode, text) => {
    expect(parseQuery(input)).toEqual({ mode, text });
  });
});
