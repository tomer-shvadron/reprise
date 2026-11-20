import { describe, expect, it } from 'vitest';

import { libraryLabel, savedLabel, soundTierLabel } from './status-text';

describe('savedLabel', () => {
  it('is hidden without a song', () => {
    expect(savedLabel({ hasScore: false, dirty: true, saving: true })).toBeUndefined();
  });

  it('reads Saving…, Unsaved and Saved, in that order of priority', () => {
    expect(savedLabel({ hasScore: true, dirty: true, saving: true })).toBe('Saving…');
    expect(savedLabel({ hasScore: true, dirty: true, saving: false })).toBe('Unsaved');
    expect(savedLabel({ hasScore: true, dirty: false, saving: false })).toBe('Saved');
  });
});

describe('libraryLabel', () => {
  const idle = { phase: 'idle', total: 0, done: 0 } as const;

  it('shows the import while it runs, even with no song open', () => {
    const importer = { phase: 'running', total: 48, done: 12 } as const;
    expect(libraryLabel({ hasScore: false, songId: undefined, hasFile: false, importer })).toBe(
      'Importing 12 of 48',
    );
  });

  it('says whether the open song is in the library', () => {
    expect(libraryLabel({ hasScore: true, songId: 's1', hasFile: true, importer: idle })).toBe(
      'In library',
    );
    expect(libraryLabel({ hasScore: true, songId: undefined, hasFile: true, importer: idle })).toBe(
      'Not in library',
    );
  });

  it('is hidden with no song, and for a new song that has no file yet', () => {
    expect(
      libraryLabel({ hasScore: false, songId: undefined, hasFile: false, importer: idle }),
    ).toBeUndefined();
    expect(
      libraryLabel({ hasScore: true, songId: undefined, hasFile: false, importer: idle }),
    ).toBeUndefined();
  });

  it('keeps the finished summary out of the bar', () => {
    const importer = { phase: 'done', total: 3, done: 3 } as const;
    expect(libraryLabel({ hasScore: true, songId: 's1', hasFile: true, importer })).toBe(
      'In library',
    );
  });
});

describe('soundTierLabel', () => {
  it('is GM for no tracks and for tracks with no entry', () => {
    expect(soundTierLabel([], {})).toBe('GM');
    expect(soundTierLabel(['a', 'b'], {})).toBe('GM');
  });

  it('is HQ when every track plays a pack, and GM + HQ when it is mixed', () => {
    expect(soundTierLabel(['a'], { a: { tier: 'hq', packId: 'p' } })).toBe('HQ');
    expect(soundTierLabel(['a', 'b'], { a: { tier: 'hq', packId: 'p' } })).toBe('GM + HQ');
  });

  it('counts a track whose pack is missing as GM', () => {
    expect(soundTierLabel(['a'], { a: { tier: 'gm', packId: 'p', problem: 'missing' } })).toBe(
      'GM',
    );
  });
});
