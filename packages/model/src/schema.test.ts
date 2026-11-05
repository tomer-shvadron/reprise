import { describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';

import { BeatSchema, DurationSchema } from './beat';
import { ColorSchema } from './color';
import { createBeat, createMasterBar, createNote, createTrack } from './factories';
import { MasterBarSchema, TimeSignatureSchema } from './master-bar';
import { BendPointSchema } from './note';
import type { Note } from './note';
import { buildFullScore } from './full-score.fixture';
import { ScoreSchema } from './score';
import { TempoMarkSchema } from './tempo';
import { ChannelSettingsSchema, TrackSchema } from './track';
import { validateScore } from './validate';

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
