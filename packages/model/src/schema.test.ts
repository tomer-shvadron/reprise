import { describe, expect, it } from 'vitest';

import { BeatSchema } from './beat';
import type { Beat } from './beat';
import {
  createBar,
  createBeat,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  createVoice,
} from './factories';
import { newId } from './id';
import type { Note } from './note';
import { SCORE_VERSION, ScoreSchema } from './score';
import type { Score } from './score';
import { validateScore } from './validate';

function buildFullScore(): Score {
  const bend = createNote({
    string: 3,
    fret: 7,
    bend: {
      kind: 'bendRelease',
      points: [
        { position: 0, value: 0 },
        { position: 30, value: 4 },
        { position: 60, value: 0 },
      ],
    },
    slide: ['legato'],
    harmonic: { kind: 'artificial', value: 12 },
    trill: { fret: 9, speed: 32 },
    leftHandFinger: 'ring',
    rightHandFinger: 'index',
    accent: 'heavy',
    vibrato: 'wide',
    accidental: 'flat',
    dynamics: 'mp',
  });
  const chord: Beat = createBeat({
    duration: 8,
    dots: 1,
    notes: [bend, createNote({ string: 2, fret: 8, palmMute: true, letRing: true })],
    text: 'let ring',
    chordDiagram: {
      name: 'Am',
      complete: true,
      baseFret: 1,
      frets: [0, 1, 2, 2, 0, null],
      barres: [{ fret: 1, firstString: 1, lastString: 2 }],
      fingering: [null, 'index', 'ring', 'middle', null, null],
    },
    effects: {
      tremoloPicking: 16,
      pickStroke: 'down',
      fadeIn: true,
      arpeggio: { direction: 'up', duration: 16 },
      brush: { direction: 'down' },
      vibrato: 'slight',
      whammy: {
        kind: 'dive',
        points: [
          { position: 0, value: 0 },
          { position: 60, value: -8 },
        ],
      },
    },
    grace: [{ duration: 32, before: true, notes: [createNote({ string: 3, fret: 5 })] }],
    mix: {
      program: 29,
      volume: { value: 90, duration: 2, allTracks: true },
      pan: { value: 32 },
      tempo: { value: 96.5, duration: 4, label: 'Slower' },
    },
    lyrics: ['Hel-', '', 'lo'],
  });
  const tied: Note = createNote({ string: 3, fret: 7, tie: true });
  const triplet = createBeat({ duration: 8, tuplet: { n: 3, of: 2 }, notes: [tied] });
  const rest = createBeat({ duration: 2, rest: true });

  const guitar = createTrack('fretted', {
    bars: [
      {
        ...createBar(),
        voices: [createVoice([chord, triplet, rest]), createVoice(), createVoice(), createVoice()],
      },
      createBar({ clef: 'bass' }),
    ],
    sound: { packId: newId(), preset: 'clean' },
  });
  const kick = createNote({ string: 0, fret: 36 });
  const drums = createTrack('drums', {
    bars: [
      {
        ...createBar(),
        voices: [
          createVoice([createBeat({ notes: [kick] })]),
          createVoice(),
          createVoice(),
          createVoice(),
        ],
      },
      createBar(),
    ],
  });

  return {
    id: newId(),
    version: SCORE_VERSION,
    meta: createScoreMeta({ title: 'Fixture', notices: ['one', 'two'] }),
    masterBars: [
      createMasterBar({
        tempo: { bpm: 120, label: 'Moderato' },
        repeat: { start: true, endCount: 2 },
        alternateEndings: [1],
        targets: ['segno'],
        section: { name: 'Intro', letter: 'A', color: '#ff8800' },
        tripletFeel: 'eighth',
      }),
      createMasterBar({
        timeSignature: { numerator: 6, denominator: 8 },
        keySignature: { fifths: -3, minor: true },
        alternateEndings: [2],
        jump: { kind: 'dsAlFine' },
        doubleBar: true,
      }),
    ],
    tracks: [guitar, drums],
  };
}

describe('ScoreSchema', () => {
  it('round-trips a score that uses every node type, through JSON', () => {
    const score = buildFullScore();
    expect(validateScore(score)).toEqual([]);
    const parsed = ScoreSchema.parse(JSON.parse(JSON.stringify(score)));
    expect(parsed).toEqual(score);
  });

  it('reports a wrong field with its path', () => {
    const score = buildFullScore();
    const result = ScoreSchema.safeParse({
      ...score,
      tracks: score.tracks.map((track, t) =>
        t === 0
          ? {
              ...track,
              bars: track.bars.map((bar, b) =>
                b === 0
                  ? {
                      ...bar,
                      voices: bar.voices.map((voice, v) =>
                        v === 0
                          ? {
                              ...voice,
                              beats: voice.beats.map((beat) => ({ ...beat, duration: 3 })),
                            }
                          : voice,
                      ),
                    }
                  : bar,
              ),
            }
          : track,
      ),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual([
      'tracks',
      0,
      'bars',
      0,
      'voices',
      0,
      'beats',
      0,
      'duration',
    ]);
  });

  it('rejects an explicit undefined where a field is optional', () => {
    const score = buildFullScore();
    const result = ScoreSchema.safeParse({
      ...score,
      masterBars: score.masterBars.map((masterBar) => ({ ...masterBar, tempo: undefined })),
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['masterBars', 0, 'tempo']);
  });

  it('requires exactly four voices per bar', () => {
    const score = buildFullScore();
    const bar = score.tracks[0]?.bars[1];
    const result = ScoreSchema.safeParse({
      ...score,
      tracks: [
        {
          ...score.tracks[0],
          bars: [score.tracks[0]?.bars[0], { ...bar, voices: bar?.voices.slice(0, 2) }],
        },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path.slice(0, 5)).toEqual(['tracks', 0, 'bars', 1, 'voices']);
  });

  it('caps lyrics at five lines', () => {
    expect(BeatSchema.safeParse(createBeat({ lyrics: ['a', 'b', 'c', 'd', 'e'] })).success).toBe(
      true,
    );
    const result = BeatSchema.safeParse(createBeat({ lyrics: ['a', 'b', 'c', 'd', 'e', 'f'] }));
    expect(result.error?.issues[0]?.path).toEqual(['lyrics']);
  });

  it('keeps optional properties exact in the inferred types', () => {
    // @ts-expect-error exactOptional: an absent field cannot be written as undefined
    const note: Note = { ...createNote({ string: 1, fret: 0 }), bend: undefined };
    expect(note).toHaveProperty('bend');
  });
});
