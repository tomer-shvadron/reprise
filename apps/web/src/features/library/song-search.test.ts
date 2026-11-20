import { describe, expect, it } from 'vitest';

import { entryOf } from './search';
import { rankSongs } from './song-search';
import { rowOf } from './test-support';

const entries = [
  entryOf(rowOf({ id: 'a', title: 'Blue Bossa', artist: 'Kenny', album: '' })),
  entryOf(rowOf({ id: 'b', title: 'Naïve', artist: 'Heads', album: 'Fear', lastOpenedAt: 50 })),
  entryOf(rowOf({ id: 'c', title: 'Big Blue', artist: 'X', album: 'Y', lastOpenedAt: 90 })),
  entryOf(rowOf({ id: 'd', title: ' ', originalName: 'raw.gp', artist: '', album: '' })),
];
const ids = (rows: { id: string }[]) => rows.map((row) => row.id);

describe('rankSongs', () => {
  it('lists opened songs by last opened, then the rest by title', () => {
    expect(ids(rankSongs(entries, '', undefined).rows)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('puts title prefixes first, folds accents and names a blank title by its file', () => {
    expect(ids(rankSongs(entries, 'blue', undefined).rows)).toEqual(['a', 'c']);
    expect(ids(rankSongs(entries, 'naive', undefined).rows)).toEqual(['b']);
    expect(rankSongs(entries, 'raw', undefined).rows[0]?.label).toBe('raw.gp');
  });

  it('drops empty detail parts and tags the open song', () => {
    const { rows } = rankSongs(entries, '', 'a');
    expect(rows.find((row) => row.id === 'a')).toMatchObject({ detail: 'Kenny', open: true });
    expect(rows.find((row) => row.id === 'b')?.detail).toBe('Heads · Fear');
  });

  it('caps the rows and reports the total', () => {
    const many = Array.from({ length: 80 }, (_, i) => entryOf(rowOf({ id: `s${String(i)}` })));
    const ranked = rankSongs(many, '', undefined);
    expect(ranked.rows).toHaveLength(50);
    expect(ranked.total).toBe(80);
  });
});
