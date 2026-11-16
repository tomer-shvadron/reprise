import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { nextOnString } from './next-on-string';

const built = score().track('guitar');
built
  .bar()
  .beat('4', [note(1, 5)])
  .beat('4', [note(2, 7)])
  .rest('4')
  .beat('4', [note(3, 0)]);
built.bar().rest('1');
built.bar().beat('1', [note(1, 12)]);
built.bar().rest('1');
built.bar().beat('1', [note(1, 3)]);
const song = built.build();
const [track] = song.tracks;
if (!track) throw new Error('a track');

describe('nextOnString', () => {
  it('skips beats with no note on the string, and rests', () => {
    expect(nextOnString(track, { bar: 0, voice: 0, beat: 0 }, 3, 1)?.beat).toBe(3);
    expect(nextOnString(track, { bar: 0, voice: 0, beat: 1 }, 1, 1)).toBeUndefined();
  });

  it('crosses bar lines within the reach and not past it', () => {
    const found = nextOnString(track, { bar: 0, voice: 0, beat: 0 }, 1, 2);
    expect(found).toMatchObject({ bar: 2, beat: 0 });
    expect(found?.note.fret).toBe(12);
    expect(nextOnString(track, { bar: 0, voice: 0, beat: 0 }, 1, 1)).toBeUndefined();
    expect(nextOnString(track, { bar: 2, voice: 0, beat: 0 }, 1, 3)?.note.fret).toBe(3);
    expect(nextOnString(track, { bar: 2, voice: 0, beat: 0 }, 1, 1)).toBeUndefined();
  });

  it('stays in the voice', () => {
    expect(nextOnString(track, { bar: 0, voice: 1, beat: 0 }, 1, 3)).toBeUndefined();
  });
});
