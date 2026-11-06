import { describe, expect, it } from 'vitest';

import { LONG_FIXTURE, parseDemoParams, serializeDemoParams } from './demo-params';

describe('demo parameters', () => {
  it('defaults to the long score, paged A4, at zoom 1', () => {
    expect(parseDemoParams('', 'light')).toEqual({
      fixture: LONG_FIXTURE,
      mode: 'paged',
      paper: 'a4',
      notation: 'default',
      zoom: 1,
      theme: 'light',
      view: 'scroll',
    });
  });

  it('reads every parameter', () => {
    expect(
      parseDemoParams(
        '?fixture=gp5/staves.gp5&mode=continuous&paper=letter&notation=both&zoom=0.75&theme=dark&view=pages',
        'light',
      ),
    ).toEqual({
      fixture: 'gp5/staves.gp5',
      mode: 'continuous',
      paper: 'letter',
      notation: 'both',
      zoom: 0.75,
      theme: 'dark',
      view: 'pages',
    });
  });

  it('falls back on invalid values and clamps the zoom', () => {
    expect(
      parseDemoParams(
        '?fixture=&mode=x&paper=a3&notation=jianpu&zoom=abc&theme=blue&view=y',
        'dark',
      ),
    ).toEqual(parseDemoParams('', 'dark'));
    expect(parseDemoParams('?zoom=9', 'dark').zoom).toBe(3);
    expect(parseDemoParams('?zoom=0.1', 'dark').zoom).toBe(0.5);
  });

  it('round-trips through the query string', () => {
    const params = parseDemoParams('?fixture=gp4/notes.gp4&mode=continuous&zoom=2', 'light');
    expect(parseDemoParams(serializeDemoParams(params), 'dark')).toEqual(params);
  });
});
