import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import { BeatSchema, DurationSchema } from './beat';
import type { Beat } from './beat';
import { ColorSchema } from './color';
import {
  STANDARD_TUNING,
  createBar,
  createBeat,
  createMasterBar,
  createNote,
  createScoreMeta,
  createTrack,
  createVoice,
} from './factories';
import { newId } from './id';
import { MasterBarSchema, TimeSignatureSchema } from './master-bar';
import { BendPointSchema } from './note';
import type { Note } from './note';
import { SCORE_VERSION, ScoreSchema } from './score';
import type { Score } from './score';
import { TempoMarkSchema } from './tempo';
import { ChannelSettingsSchema, TrackSchema } from './track';
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
    chord: {
      name: 'Am',
      diagram: {
        baseFret: 1,
        frets: [0, 1, 2, 2, 0, null],
        barres: [{ fret: 1, firstString: 1, lastString: 2 }],
        fingering: [null, 'index', 'ring', 'middle', null, null],
      },
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
      tempo: { bpm: 96.5, unit: 'eighth', duration: 4, label: 'Slower' },
    },
    lyrics: ['Hel-', '', 'lo'],
  });
  const tied: Note = createNote({ string: 3, fret: 7, tie: true });
  const triplet = createBeat({ duration: 8, tuplet: { n: 3, of: 2 }, notes: [tied] });
  const rest = createBeat({ duration: 2, rest: true });
  const tiny = createBeat({ duration: 256, rest: true, chord: { name: 'E7' } });

  const guitar = createTrack('fretted', {
    bars: [
      {
        ...createBar(),
        voices: [
          createVoice([chord, triplet, rest, tiny]),
          createVoice(),
          createVoice(),
          createVoice(),
        ],
      },
      createBar({ clef: 'bass' }),
    ],
    channel: {
      volume: 90,
      pan: 64,
      chorus: 0,
      reverb: 20,
      phaser: 0,
      tremolo: 0,
      mute: false,
      solo: true,
    },
    sound: { packId: newId(), preset: 'clean' },
    lyrics: [
      { startBar: 0, text: 'Hel-lo' },
      { startBar: 1, text: 'world' },
    ],
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
  // A GP5 keyboard part keeps the tuning it was written against.
  const keys = createTrack('pitched', {
    tuning: [...STANDARD_TUNING],
    fretCount: 24,
    bars: [
      {
        ...createBar(),
        voices: [
          createVoice([createBeat({ notes: [createNote({ string: 0, fret: 60 })] })]),
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
        tempo: { bpm: 120, unit: 'dottedQuarter', label: 'Moderato' },
        repeat: { start: true, endCount: 2 },
        alternateEndings: [1],
        targets: ['segno'],
        section: { name: 'Intro', letter: 'A', color: '#ff8800' },
        tripletFeel: 'eighth',
        anacrusis: true,
      }),
      createMasterBar({
        timeSignature: { numerator: 6, denominator: 8 },
        keySignature: { fifths: -3, minor: true },
        alternateEndings: [2],
        jumps: [{ kind: 'dsAlFine' }, { kind: 'toCoda' }],
        doubleBar: true,
      }),
    ],
    tracks: [guitar, drums, keys],
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
    const beat = score.tracks[0]?.bars[0]?.voices[0]?.beats[0];
    if (!beat) throw new Error('the fixture has no first beat');
    Reflect.set(beat, 'duration', 3);
    const result = ScoreSchema.safeParse(score);
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

describe('field ranges', () => {
  const channel = createTrack('fretted').channel;
  const lyricLines = (count: number) =>
    Array.from({ length: count }, () => ({ startBar: 0, text: '' }));

  it.each<[string, ZodType, unknown, boolean]>([
    ['bend position 60', BendPointSchema, { position: 60, value: 4 }, true],
    ['bend position 61', BendPointSchema, { position: 61, value: 4 }, false],
    ['whammy below zero', BendPointSchema, { position: 0, value: -8 }, true],
    ['volta 8', MasterBarSchema, createMasterBar({ alternateEndings: [8] }), true],
    ['volta 9', MasterBarSchema, { ...createMasterBar(), alternateEndings: [9] }, false],
    ['lower-case colour', ColorSchema, '#ff8800', true],
    ['upper-case colour', ColorSchema, '#FF8800', false],
    ['denominator 32', TimeSignatureSchema, { numerator: 7, denominator: 32 }, true],
    ['denominator 3', TimeSignatureSchema, { numerator: 7, denominator: 3 }, false],
    ['controller 127', ChannelSettingsSchema, { ...channel, volume: 127 }, true],
    ['controller 128', ChannelSettingsSchema, { ...channel, volume: 128 }, false],
    ['256th note', DurationSchema, 256, true],
    ['512th note', DurationSchema, 512, false],
    [
      'ten strings',
      TrackSchema,
      createTrack('fretted', { tuning: new Array<number>(10).fill(40) }),
      true,
    ],
    [
      'eleven strings',
      TrackSchema,
      createTrack('fretted', { tuning: new Array<number>(11).fill(40) }),
      false,
    ],
    ['five lyric lines', TrackSchema, createTrack('fretted', { lyrics: lyricLines(5) }), true],
    ['six lyric lines', TrackSchema, createTrack('fretted', { lyrics: lyricLines(6) }), false],
    ['tempo unit', TempoMarkSchema, { bpm: 120, unit: 'dottedQuarter' }, true],
    ['tempo unit outside the gpif set', TempoMarkSchema, { bpm: 120, unit: 'whole' }, false],
    ['tempo zero', TempoMarkSchema, { bpm: 0 }, false],
  ])('%s', (_name, schema, value, accepted) => {
    expect(schema.safeParse(value).success).toBe(accepted);
  });
});
