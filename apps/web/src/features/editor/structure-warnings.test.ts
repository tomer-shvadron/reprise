import { score as scoreBuilder } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { newStructureWarnings, structureWarnings } from './structure-warnings';

describe('structureWarnings', () => {
  it('names a jump whose target is missing by its engraved label', () => {
    const built = scoreBuilder().track('guitar');
    built.bar().jump('dsAlCoda');
    built.bar();
    expect(structureWarnings(built.build())).toEqual([
      'D.S. al Coda at bar 1 has no segno; ignored',
    ]);
  });

  it('warns about a repeat end with no repeat start', () => {
    const built = scoreBuilder().track('guitar');
    built.bar();
    built.bar().repeatEnd(2);
    expect(structureWarnings(built.build())).toEqual([
      'Repeat end at bar 2 has no repeat start; repeating from bar 1',
    ]);
  });

  it('warns about an ending numbered past the play count, which nothing else catches', () => {
    const built = scoreBuilder().track('guitar');
    built.bar().repeatStart();
    built.bar().repeatEnd(2).volta([1]);
    built.bar().volta([2]);
    built.bar().volta([3]);
    expect(structureWarnings(built.build())).toEqual([
      'Ending 3 at bar 2 is never played: the repeat plays 2 times',
    ]);
  });

  it('is quiet for a sound structure, and endings below the count', () => {
    const built = scoreBuilder().track('guitar');
    built.bar().repeatStart();
    built.bar().repeatEnd(3).volta([1]);
    built.bar().volta([2]);
    expect(structureWarnings(built.build())).toEqual([]);
  });
});

describe('newStructureWarnings', () => {
  it('reports only what an edit brought, not what the song already had', () => {
    const had = scoreBuilder().track('guitar');
    had.bar().jump('dsAlCoda');
    had.bar();
    const before = had.build();
    const after = scoreBuilder().track('guitar');
    after.bar().jump('dsAlCoda');
    after.bar();
    after.bar().repeatEnd(2);
    expect(newStructureWarnings(before, after.build())).toEqual([
      'Repeat end at bar 3 has no repeat start; repeating from bar 1',
    ]);
  });
});
