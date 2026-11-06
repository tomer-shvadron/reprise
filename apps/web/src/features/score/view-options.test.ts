import { PAGE_SIZES } from '@reprise/layout';
import { fullScore } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { CONTINUOUS_SYSTEM_WIDTH, uniformNotation, viewLayoutOptions } from './view-options';

describe('viewLayoutOptions', () => {
  const content = { tracks: 'all', notation: {} } as const;

  it('lays out paged views at the paper size', () => {
    expect(viewLayoutOptions({ mode: 'paged', paper: 'a4' }, content)).toEqual({
      mode: 'paged',
      width: PAGE_SIZES.a4.width,
      pageHeight: PAGE_SIZES.a4.height,
      zoom: 1,
      tracks: 'all',
      notation: {},
    });
    expect(viewLayoutOptions({ mode: 'paged', paper: 'letter' }, content)).toMatchObject({
      width: 816,
      pageHeight: 1056,
    });
  });

  it('lays out continuous views in fixed segments', () => {
    expect(viewLayoutOptions({ mode: 'continuous', paper: 'letter' }, content)).toEqual({
      mode: 'continuous',
      width: CONTINUOUS_SYSTEM_WIDTH,
      zoom: 1,
      tracks: 'all',
      notation: {},
    });
  });

  it('passes the content options through', () => {
    const options = viewLayoutOptions(
      { mode: 'paged', paper: 'a4' },
      { tracks: ['a'], notation: { a: 'both' }, tiedNotes: 'hidden' },
    );
    expect(options).toMatchObject({ tracks: ['a'], notation: { a: 'both' }, tiedNotes: 'hidden' });
  });
});

describe('uniformNotation', () => {
  it('maps every track or none', () => {
    const score = fullScore();
    expect(uniformNotation(score, 'default')).toEqual({});
    const both = uniformNotation(score, 'both');
    expect(Object.keys(both)).toEqual(score.tracks.map(({ id }) => id));
    expect(new Set(Object.values(both))).toEqual(new Set(['both']));
  });
});
