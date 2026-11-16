import { openStringPitch } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { copyClip } from './clip';
import type { Clip } from './clipboard-format';
import { refinger } from './refinger';
import { beatsRange } from './test/clip-scores';
import { must } from './test/must';

const SEVEN = [35, 40, 45, 50, 55, 59, 64];
const BASS = [28, 33, 38, 43];

function clipOf(notesPerBeat: ReturnType<typeof note>[][], tuning?: number[]): Clip {
  const built = score().track('guitar', tuning ? { tuning } : {});
  const bar = built.bar();
  for (const notes of notesPerBeat) bar.beat('8', notes);
  const done = built.build({ ids: 'sequential' });
  const result = copyClip(done, {
    cursor: undefined,
    range: beatsRange(done, { first: 0, bar: 0, from: 0, to: notesPerBeat.length - 1 }),
  });
  if ('refused' in result) throw new Error(result.refused);
  return result.clip;
}

const frets = (clip: ReturnType<typeof refinger>['track']) =>
  clip.bars[0]?.voices[0]?.beats.map(({ notes }) =>
    notes.map(({ string, fret }) => [string, fret]),
  );

describe('refinger', () => {
  it('keeps the pitch from six to seven strings, on the same string index', () => {
    const clip = clipOf([[note(1, 5)], [note(6, 3)]]);
    const result = refinger(must(clip.tracks[0]), { tuning: SEVEN, fretCount: 24 });
    // The seven-string neck's string 1 is the same high E; string 6 is its A, one above the low B.
    expect(result.dropped).toBe(0);
    expect(frets(result.track)).toEqual([[[1, 5]], [[6, 3]]]);
    expect(result.track.tuning).toEqual(SEVEN);
  });

  it('puts six strings on a four-string bass, leaving out notes that sound nowhere', () => {
    // High E fret 12 (E5, 76) and low E fret 0 (E2, 40): the bass neck holds neither at 24 frets? E2 = 40 is above its low E (28) by 12.
    const clip = clipOf([[note(1, 12)], [note(6, 0)], [note(6, 0), note(1, 12)]]);
    const result = refinger(must(clip.tracks[0]), { tuning: BASS, fretCount: 24 });
    const bass = { tuning: BASS };
    const pitches = result.track.bars[0]?.voices[0]?.beats.map(({ notes }) =>
      notes.map((n) => must(openStringPitch(bass, n.string)) + n.fret),
    );
    // E5 (76) is above the bass's highest string (43) plus 24 frets (67): out of range.
    expect(pitches).toEqual([[], [40], [40]]);
    expect(result.dropped).toBe(2);
    // A beat that lost every note became a rest.
    expect(result.track.bars[0]?.voices[0]?.beats[0]).toMatchObject({ rest: true, notes: [] });
  });

  it('gives a chord distinct strings', () => {
    // Three notes with the same pitch preference collide on one string when squeezed: 4 strings.
    const clip = clipOf([[note(4, 3), note(5, 2), note(6, 3)]]);
    const result = refinger(must(clip.tracks[0]), { tuning: BASS, fretCount: 24 });
    const strings =
      result.track.bars[0]?.voices[0]?.beats[0]?.notes.map(({ string }) => string) ?? [];
    expect(new Set(strings).size).toBe(strings.length);
    expect(strings.length + result.dropped).toBe(3);
  });

  it('keeps a tie chain on the string its origin got', () => {
    const clip = clipOf([[note(3, 2)], [note(3, 2, { tie: true })]]);
    const result = refinger(must(clip.tracks[0]), { tuning: SEVEN, fretCount: 24 });
    const [first, second] = result.track.bars[0]?.voices[0]?.beats ?? [];
    expect(second?.notes[0]?.string).toBe(first?.notes[0]?.string);
    expect(second?.notes[0]?.fret).toBe(first?.notes[0]?.fret);
  });
});
