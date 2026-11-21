import { midiNote, openStringPitch } from '@reprise/model';
import { note, score } from '@reprise/model/testing';
import { describe, expect, it } from 'vitest';

import { copyClip } from './clip';
import type { Clip } from './clipboard-format';
import { refinger } from './refinger';
import { beatsRange } from './test/clip-scores';
import { must } from './test/must';

const SEVEN = { tuning: [35, 40, 45, 50, 55, 59, 64], fretCount: 24, capo: 0 };
const BASS = { tuning: [28, 33, 38, 43], fretCount: 24, capo: 0 };

type Built = ReturnType<typeof note>;

function clipOf(
  notesPerBeat: Built[][],
  track: { tuning?: number[]; capo?: number } = {},
  spec: Parameters<ReturnType<typeof score>['beat']>[2] = {},
): Clip {
  const built = score().track('guitar', track);
  const bar = built.bar();
  for (const notes of notesPerBeat) bar.beat('8', notes, spec);
  const done = built.build({ ids: 'sequential' });
  const result = copyClip(done, {
    cursor: undefined,
    range: beatsRange(done, { first: 0, bar: 0, from: 0, to: notesPerBeat.length - 1 }),
  });
  if ('refused' in result) throw new Error(result.refused);
  return result.clip;
}

type Out = ReturnType<typeof refinger>['track'];

const beatsOf = (track: Out) => track.bars[0]?.voices[0]?.beats ?? [];
const frets = (track: Out) =>
  beatsOf(track).map(({ notes }) => notes.map((n) => [n.string, n.fret]));
const pitches = (track: Out) =>
  beatsOf(track).map(({ notes }) =>
    notes.map((n) => midiNote({ kind: 'fretted', tuning: track.tuning, capo: track.capo }, n)),
  );

describe('refinger', () => {
  it('keeps the pitch from six to seven strings, on the string tuned the same', () => {
    const clip = clipOf([[note(1, 5)], [note(6, 3)]]);
    const result = refinger(must(clip.tracks[0]), SEVEN);
    expect(result.dropped).toBe(0);
    expect(frets(result.track)).toEqual([[[1, 5]], [[6, 3]]]);
    expect(result.track.tuning).toEqual(SEVEN.tuning);
  });

  it('counts frets from each capo, so a capo 2 guitar keeps MIDI 52 on a bass without one', () => {
    // String 4 open is D3 (50); with the capo on 2 its open sound is E3 (52).
    const clip = clipOf([[note(4, 0)]], { capo: 2 });
    const result = refinger(must(clip.tracks[0]), BASS);
    expect(pitches(result.track)).toEqual([[52]]);
    // The bass has no D string: the lowest fret that fits, on the bass's string 1 (G, 43).
    expect(frets(result.track)).toEqual([[[1, 9]]]);
    expect(result.track.capo).toBe(0);
    // And the other way: a capo on the target moves the fret down.
    const back = refinger(must(clipOf([[note(1, 9)]], { tuning: BASS.tuning }).tracks[0]), {
      ...SEVEN,
      capo: 2,
    });
    const [only] = pitches(back.track);
    expect(only).toEqual([52]);
  });

  it('prefers the string tuned to the same open pitch, then the lowest fret', () => {
    // Guitar string 5 is A2 (45): fret 5 sounds D3 (50), which the seven-string's string 4 plays open.
    const clip = clipOf([[note(5, 5)]]);
    expect(frets(refinger(must(clip.tracks[0]), SEVEN).track)).toEqual([[[5, 5]]]);
    // On the bass no string matches, so the lowest fret wins: A2 (45) is string 1, fret 2.
    const low = refinger(must(clipOf([[note(6, 5)]]).tracks[0]), BASS);
    expect(frets(low.track)).toEqual([[[1, 2]]]);
  });

  it('puts six strings on a four-string bass, leaving out notes that sound nowhere', () => {
    const clip = clipOf([[note(1, 12)], [note(6, 0)], [note(6, 0), note(1, 12)]]);
    const result = refinger(must(clip.tracks[0]), BASS);
    const bass = { tuning: BASS.tuning };
    const heard = beatsOf(result.track).map(({ notes }) =>
      notes.map((n) => must(openStringPitch(bass, n.string)) + n.fret),
    );
    // E5 (76) is above the bass's top string (43) plus 24 frets (67): out of range.
    expect(heard).toEqual([[], [40], [40]]);
    expect(result.dropped).toBe(2);
    expect(beatsOf(result.track)[0]).toMatchObject({ rest: true, notes: [] });
  });

  it('gives a chord distinct strings', () => {
    const clip = clipOf([[note(4, 3), note(5, 2), note(6, 3)]]);
    const result = refinger(must(clip.tracks[0]), BASS);
    const strings = beatsOf(result.track)[0]?.notes.map(({ string }) => string) ?? [];
    expect(new Set(strings).size).toBe(strings.length);
    expect(strings.length + result.dropped).toBe(3);
  });

  it('keeps a tie chain on the string its origin got', () => {
    const clip = clipOf([[note(3, 2)], [note(3, 2, { tie: true })]]);
    const result = refinger(must(clip.tracks[0]), BASS);
    const [first, second] = beatsOf(result.track);
    expect(second?.notes[0]?.string).toBe(first?.notes[0]?.string);
    expect(second?.notes[0]?.fret).toBe(first?.notes[0]?.fret);
  });

  it('moves a trill by the same number of frets, and drops it when it falls off the neck', () => {
    // G3 fret 0 trilled to fret 2 (A3): on the bass string 1 fret 12 and 14.
    const clip = clipOf([[note(3, 0, { trill: { fret: 2, speed: 16 } })]]);
    const result = refinger(must(clip.tracks[0]), BASS);
    expect(beatsOf(result.track)[0]?.notes[0]).toMatchObject({
      string: 1,
      fret: 12,
      trill: { fret: 14 },
    });
    expect(result.trillsDropped).toBe(0);
    // A neck that ends at fret 12 cannot hold the trill's fret 14.
    const short = refinger(must(clip.tracks[0]), { ...BASS, fretCount: 12 });
    expect(beatsOf(short.track)[0]?.notes[0]?.trill).toBeUndefined();
    expect(short.trillsDropped).toBe(1);
  });

  it('counts a natural harmonic that moved, and leaves one that did not', () => {
    const harmonic = { kind: 'natural', value: 12 } as const;
    const clip = clipOf([[note(1, 12, { harmonic })]]);
    expect(refinger(must(clip.tracks[0]), SEVEN).harmonicsMoved).toBe(0);
    const moved = refinger(must(clipOf([[note(3, 5, { harmonic })]]).tracks[0]), BASS);
    expect(moved.harmonicsMoved).toBe(1);
  });

  it('re-fingers the notes of a grace beat on their own', () => {
    const grace = [{ duration: 16 as const, before: true, notes: [note(3, 2)] }];
    const clip = clipOf([[note(3, 2)]], {}, { grace });
    const result = refinger(must(clip.tracks[0]), BASS);
    const ornament = beatsOf(result.track)[0]?.grace?.[0]?.notes[0];
    expect(ornament).toMatchObject({ string: 1, fret: 14 });
  });
});

describe('refinger onto a banjo drone string', () => {
  const BANJO = {
    tuning: [67, 50, 55, 59, 62],
    fretCount: 22,
    capo: 0,
    drone: { string: 5, fret: 5 },
  };
  const plain = { tuning: [67, 50, 55, 59, 62] };

  it('never lands a note past the drone string, which is five frets shorter', () => {
    const clip = clipOf([[note(5, 17)], [note(5, 18)]], plain);
    const result = refinger(must(clip.tracks[0]), BANJO);
    expect(result.track.drone).toEqual(BANJO.drone);
    // Fret 17 is the last stored fret on the drone string; 18 sounds nowhere else on the banjo.
    expect(frets(result.track)).toEqual([[[5, 17]], []]);
    expect(result.dropped).toBe(1);
  });
});
