import { describe, expect, it } from 'vitest';

import { beatTicks, expandPlaybackSequence, midiNote, validateScore } from '../index';
import { beatOf, fullScore, largeScore, midi, note, noteOf, parseDuration, score } from './index';
import { ScoreBuildError } from './score-builder';
import type { ScoreBuilder } from './score-builder';

describe('score()', () => {
  it('builds the empty score: one guitar, one bar of 4/4 at 120', () => {
    const built = score().build();
    expect(built.tracks.map((track) => track.kind)).toEqual(['fretted']);
    expect(built.masterBars).toHaveLength(1);
    expect(built.masterBars[0]).toMatchObject({
      tempo: { bpm: 120 },
      timeSignature: { numerator: 4, denominator: 4 },
    });
    expect(validateScore(built)).toEqual([]);
  });

  it('reads as the score it builds', () => {
    const built = score()
      .title('Riff')
      .tempo(96)
      .timeSignature(3, 4)
      .track('guitar', { name: 'Lead' })
      .bar()
      .repeatStart()
      .section('Verse')
      .beat('8', [note(1, 0), note(2, 1)], { effects: { pickStroke: 'down' } })
      .beat('8', [note(3, 2)])
      .rest('2')
      .bar()
      .beat('2.', [note(6, 3)])
      .volta([1])
      .repeatEnd(2)
      .bar()
      .beat('2.', [note(6, 5)])
      .volta([2])
      .build();

    expect(built.meta.title).toBe('Riff');
    expect(built.tracks[0]?.name).toBe('Lead');
    expect(built.masterBars.map((bar) => bar.timeSignature.numerator)).toEqual([3, 3, 3]);
    expect(built.masterBars[0]).toMatchObject({
      tempo: { bpm: 96 },
      repeat: { start: true, endCount: 0 },
      section: { name: 'Verse' },
    });
    expect(built.masterBars.map((bar) => bar.alternateEndings)).toEqual([[], [1], [2]]);
    expect(beatOf(built, 0, 0, 0)).toMatchObject({
      duration: 8,
      notes: [
        { string: 1, fret: 0 },
        { string: 2, fret: 1 },
      ],
      effects: { pickStroke: 'down' },
    });
    expect(beatOf(built, 0, 0, 2)).toMatchObject({ duration: 2, rest: true, notes: [] });
    expect(expandPlaybackSequence(built).sequence.map((pass) => pass.masterBarIndex)).toEqual([
      0, 1, 0, 2,
    ]);
  });

  it('shares master bars between tracks and pads short tracks', () => {
    const built = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .bar()
      .tempo(140)
      .beat('1', [note(1, 2)])
      .track('bass')
      .bar()
      .beat('1', [note(4, 0)])
      .track('drums')
      .track('piano')
      .bar()
      .beat('2', [midi(60), midi(64)])
      .build();

    expect(built.masterBars).toHaveLength(2);
    expect(built.masterBars[1]?.tempo).toEqual({ bpm: 140 });
    expect(built.tracks.map((track) => [track.kind, track.bars.length])).toEqual([
      ['fretted', 2],
      ['fretted', 2],
      ['drums', 2],
      ['pitched', 2],
    ]);
    const bass = built.tracks[1];
    if (!bass) throw new Error('no bass');
    expect(midiNote(bass, noteOf(built, 1, 0, 0))).toBe(28);
    expect(noteOf(built, 3, 0, 0, 1)).toMatchObject({ string: 0, fret: 64 });
  });

  it('writes to the voice asked for and opens the first bar on the first beat', () => {
    const built = score()
      .track('guitar')
      .beat('4', [note(1, 0)])
      .voice(1)
      .beat('1', [note(6, 0)])
      .build();
    expect(built.tracks[0]?.bars[0]?.voices.map((voice) => voice.beats.length)).toEqual([
      1, 1, 0, 0,
    ]);
    expect(noteOf(built, 0, 0, 0, 0, 1)).toMatchObject({ string: 6, fret: 0 });
  });

  it('builds master-bar-only scores for playback tests', () => {
    const built = score()
      .bar()
      .target('segno')
      .bar()
      .jump('dalSegno')
      .bar()
      .anacrusis()
      .masterBar({ doubleBar: true })
      .build();
    expect(built.masterBars.map((bar) => [bar.targets, bar.jumps, bar.anacrusis])).toEqual([
      [['segno'], [], false],
      [[], [{ kind: 'dalSegno' }], false],
      [[], [], true],
    ]);
    expect(built.masterBars[2]?.doubleBar).toBe(true);
  });

  it('keeps the ids it is given', () => {
    const id = 'NoteNoteNote';
    const built = score()
      .id('ScoreScore00')
      .track('guitar', { id: 'TrackTrack00' })
      .bar({ id: 'BarBarBarBar' })
      .beat('4', [note(1, 0, { id })], { id: 'BeatBeatBeat' })
      .build();
    expect(built.id).toBe('ScoreScore00');
    expect(built.tracks[0]?.id).toBe('TrackTrack00');
    expect(built.tracks[0]?.bars[0]?.id).toBe('BarBarBarBar');
    expect(beatOf(built, 0, 0, 0).id).toBe('BeatBeatBeat');
    expect(noteOf(built, 0, 0, 0).id).toBe(id);
  });

  it('numbers ids in document order when asked, keeping the ids it was given', () => {
    const chain = (): ScoreBuilder =>
      score()
        .track('guitar', { id: 'TrackTrack00' })
        .bar()
        .beat('4', [note(1, 0, { id: 'NoteNoteNote' }), note(2, 1)], {
          grace: [{ duration: 16, before: true, notes: [note(3, 2)] }],
        })
        .track('drums')
        .bar()
        .beat('4', [midi(36)]);
    const built = chain().build({ ids: 'sequential' });
    expect(chain().build({ ids: 'sequential' })).toEqual(built);
    expect(validateScore(built)).toEqual([]);
    expect(built.id).toBe('score0000001');
    expect(built.masterBars.map((bar) => bar.id)).toEqual(['mbar00000001']);
    expect(built.tracks.map((track) => track.id)).toEqual(['TrackTrack00', 'track0000001']);
    expect(built.tracks[0]?.bars[0]?.id).toBe('bar000000001');
    expect(built.tracks[1]?.bars[0]?.voices.map((voice) => voice.id)).toEqual([
      'voice0000005',
      'voice0000006',
      'voice0000007',
      'voice0000008',
    ]);
    expect(beatOf(built, 0, 0, 0).id).toBe('beat00000001');
    expect(beatOf(built, 0, 0, 0).notes.map((n) => n.id)).toEqual(['NoteNoteNote', 'note00000001']);
    expect(beatOf(built, 0, 0, 0).grace?.[0]?.notes[0]?.id).toBe('note00000002');
    expect(noteOf(built, 1, 0, 0).id).toBe('note00000003');
    expect(chain().build().id).not.toBe(chain().build().id);
  });

  it('throws on a schema error and on invariant violations, unless told not to validate', () => {
    const overfull = score()
      .track('guitar')
      .bar()
      .beat('1', [note(1, 0)])
      .beat('4', [note(1, 0)]);
    expect(() => overfull.build()).toThrow(ScoreBuildError);
    expect(() => overfull.build()).toThrow(/voice-overfull at tracks\[0\]\.bars\[0\]/);
    const unchecked = score()
      .track('guitar')
      .bar()
      .beat('4', [note(1, 0, { tie: true })]);
    expect(validateScore(unchecked.build({ validate: false })).map((v) => v.rule)).toEqual([
      'tie-target',
    ]);
    expect(() =>
      score()
        .track('guitar')
        .bar()
        .beat('4', [note(1, 200)])
        .build(),
    ).toThrow(ScoreBuildError);
    const offString = score()
      .track('guitar')
      .beat('4', [note(7, 0)]);
    expect(() => offString.build()).toThrow(
      expect.objectContaining({ violations: [expect.objectContaining({ rule: 'string-range' })] }),
    );
  });

  it('refuses master-bar and beat calls with nothing to apply them to', () => {
    expect(() => score().volta([1])).toThrow(/bar\(\)/);
    expect(() => score().beat('4')).toThrow(/track\(\)/);
  });
});

describe('parseDuration', () => {
  it.each([
    ['4', { duration: 4, dots: 0 }, 960],
    ['8', { duration: 8, dots: 0 }, 480],
    ['4.', { duration: 4, dots: 1 }, 1440],
    ['2..', { duration: 2, dots: 2 }, 3360],
    ['8t', { duration: 8, dots: 0, tuplet: { n: 3, of: 2 } }, 320],
  ] as const)('reads %s', (spec, rhythm, ticks) => {
    expect(parseDuration(spec)).toEqual(rhythm);
    expect(beatTicks(parseDuration(spec))).toBe(ticks);
  });
});

describe('fixtures', () => {
  it('fullScore is valid and sets every node type', () => {
    const built = fullScore();
    expect(validateScore(built)).toEqual([]);
    expect(built.tracks.map((track) => track.kind)).toEqual(['fretted', 'drums', 'pitched']);
  });

  it('largeScore has the documented size, plain or structured, and is valid', () => {
    const plain = largeScore(8, 300);
    const notes = plain.tracks
      .flatMap((track) => track.bars)
      .flatMap((bar) => bar.voices)
      .flatMap((voice) => voice.beats)
      .reduce((sum, beat) => sum + beat.notes.length, 0);
    expect(notes).toBe(38_400);
    expect(validateScore(plain)).toEqual([]);
    const structured = largeScore(2, 40, { structure: true });
    expect(validateScore(structured)).toEqual([]);
    expect(structured.masterBars.filter((bar) => bar.repeat.endCount === 2)).toHaveLength(5);
  });
});
