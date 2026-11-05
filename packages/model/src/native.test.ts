import { describe, expect, it, vi } from 'vitest';

import type { Bar } from './bar';
import {
  createBar,
  createBeat,
  createEmptyScore,
  createMasterBar,
  createNote,
  createTrack,
  createVoice,
} from './factories';
import { buildFullScore } from './full-score-fixture';
import { MIGRATIONS, migrate } from './migrations';
import { NativeFormatError, formatPath, parseNative, serializeNative } from './native';
import type { AppInfo } from './native';
import { SCORE_VERSION, ScoreSchema } from './score';
import type { Score } from './score';
import { validateScore } from './validate';

// The package lib has neither DOM nor Node types; both runtimes provide these globals.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare const TextDecoder: new () => { decode(input: Uint8Array): string };

const APP: AppInfo = { name: 'Reprise', version: '0.0.0' };

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const envelope = (score: Score): Record<string, unknown> => ({
  format: 'reprise',
  version: SCORE_VERSION,
  app: APP,
  score,
});
const bytesOf = (value: unknown): Uint8Array => encode(JSON.stringify(value));

function parseError(bytes: Uint8Array): NativeFormatError {
  try {
    parseNative(bytes);
  } catch (error) {
    if (error instanceof NativeFormatError) return error;
    throw error;
  }
  throw new Error('parseNative did not fail');
}

// Varied durations, rests, ties and time signatures so the generated score is not one repeated bar.
function buildLargeScore(): Score {
  const bars = 200;
  const masterBars = Array.from({ length: bars }, (_, m) =>
    createMasterBar({
      ...(m % 16 === 0 && { tempo: { bpm: 90 + m } }),
      ...(m % 8 === 0 && { repeat: { start: true, endCount: 0 } }),
      ...(m % 8 === 7 && { repeat: { start: false, endCount: 2 } }),
      timeSignature:
        m % 5 === 4 ? { numerator: 3, denominator: 4 } : { numerator: 4, denominator: 4 },
    }),
  );
  const tracks = Array.from({ length: 6 }, (_, t) =>
    createTrack('fretted', {
      name: `Track ${String(t + 1)}`,
      bars: masterBars.map((masterBar, b): Bar => {
        const quarters = masterBar.timeSignature.numerator;
        const beats = Array.from({ length: quarters * 2 }, (_, i) =>
          (b + i + t) % 7 === 0
            ? createBeat({ duration: 8, rest: true })
            : createBeat({
                duration: 8,
                notes: [
                  createNote({ string: ((b * 3 + i + t) % 6) + 1, fret: (b + i * t) % 22 }),
                  ...((i + t) % 3 === 0
                    ? [
                        createNote({
                          string: ((b * 3 + i + t + 3) % 6) + 1,
                          fret: (b + i) % 12,
                          letRing: true,
                        }),
                      ]
                    : []),
                ],
                ...(i % 4 === 0 && { text: `b${String(b)}` }),
              }),
        );
        return {
          ...createBar(),
          voices: [createVoice(beats), createVoice(), createVoice(), createVoice()],
        };
      }),
    }),
  );
  return { ...createEmptyScore(), masterBars, tracks };
}

/** Re-inserts every object's keys in reverse order, leaving the content unchanged. */
function reverseKeysInPlace(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) reverseKeysInPlace(item);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const entries = Object.entries(value).reverse();
  for (const [key] of entries) Reflect.deleteProperty(value, key);
  for (const [key, child] of entries) {
    reverseKeysInPlace(child);
    Reflect.set(value, key, child);
  }
}

function at(value: unknown, ...path: (string | number)[]): unknown {
  let current = value;
  for (const key of path) {
    current =
      typeof current === 'object' && current !== null ? Reflect.get(current, key) : undefined;
  }
  return current;
}

const keysOf = (value: unknown): string[] =>
  typeof value === 'object' && value !== null ? Object.keys(value) : [];

describe('round trip', () => {
  const scores: [string, () => Score][] = [
    ['the empty score', createEmptyScore],
    ['a score using every node type and optional field', buildFullScore],
    ['a large generated score', buildLargeScore],
  ];

  it.each(scores)('parseNative(serializeNative(s)) deep-equals s for %s', (_, build) => {
    const score = build();
    expect(validateScore(score)).toEqual([]);
    const { score: parsed, app, warnings } = parseNative(serializeNative(score, APP));
    expect(parsed).toEqual(score);
    expect(app).toEqual(APP);
    expect(warnings).toEqual([]);
  });
});

describe('serializeNative', () => {
  it('writes the envelope in its documented order, two-space indented, with a trailing newline', () => {
    const text = decode(serializeNative(createEmptyScore(), APP));
    expect(text.startsWith('{\n  "format": "reprise",\n  "version": 1,\n  "app": {\n')).toBe(true);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(keysOf(JSON.parse(text))).toEqual(['format', 'version', 'app', 'score']);
  });

  it('yields identical bytes for the same score twice', () => {
    const score = buildFullScore();
    expect(serializeNative(score, APP)).toEqual(serializeNative(score, APP));
  });

  it('does not depend on the order keys were inserted in', () => {
    const score = buildFullScore();
    const shuffled = ScoreSchema.parse(JSON.parse(JSON.stringify(score)));
    reverseKeysInPlace(shuffled);
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(score));
    expect(decode(serializeNative(shuffled, APP))).toBe(decode(serializeNative(score, APP)));
  });

  it('sorts keys inside the score and keeps array order', () => {
    const score = buildFullScore();
    const written: unknown = JSON.parse(decode(serializeNative(score, APP)));
    expect(keysOf(at(written, 'score'))).toEqual(['id', 'masterBars', 'meta', 'tracks']);
    expect(keysOf(at(written, 'score', 'meta'))).toEqual(Object.keys(score.meta).sort());
    expect(at(written, 'score', 'meta', 'notices')).toEqual(['one', 'two']);
    expect([0, 1, 2].map((index) => at(written, 'score', 'tracks', index, 'kind'))).toEqual([
      'fretted',
      'drums',
      'pitched',
    ]);
  });

  it('refuses to write a score the reader would reject, naming the path', () => {
    const score = createEmptyScore();
    const masterBar = score.masterBars[0];
    if (!masterBar) throw new Error('the empty score has no master bar');
    masterBar.tempo = { bpm: Number.POSITIVE_INFINITY };
    let error: unknown;
    try {
      serializeNative(score, APP);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(NativeFormatError);
    if (error instanceof NativeFormatError) {
      expect(error.path).toEqual(['score', 'masterBars', 0, 'tempo', 'bpm']);
    }
    expect(() => serializeNative(score, { name: '', version: '1' })).toThrow(NativeFormatError);
  });

  it('does not write fields the schema does not know', () => {
    const score = createEmptyScore();
    Reflect.set(score, 'selected', true);
    Reflect.set(score.meta, 'rating', 5);
    const bytes = serializeNative(score, APP);
    expect(decode(bytes)).not.toMatch(/selected|rating/);
    expect(parseNative(bytes).warnings).toEqual([]);
  });

  it('writes non-ASCII text as UTF-8', () => {
    const score = createEmptyScore();
    score.meta.title = 'Café · 東京';
    const bytes = serializeNative(score, APP);
    expect(decode(bytes)).toContain('"title": "Café · 東京"');
    expect(parseNative(bytes).score.meta.title).toBe('Café · 東京');
  });
});

describe('parseNative failures', () => {
  it('rejects a version-0 document, naming the version', () => {
    const error = parseError(bytesOf({ ...envelope(createEmptyScore()), version: 0 }));
    expect(error.path).toEqual(['version']);
    expect(error.message).toBe('version: Version 0 does not exist; .reprise versions start at 1');
  });

  it('rejects a document newer than this app, naming both versions', () => {
    const error = parseError(
      bytesOf({ ...envelope(createEmptyScore()), version: SCORE_VERSION + 1 }),
    );
    expect(error.path).toEqual(['version']);
    expect(error.message).toContain('newer than this app');
    expect(error.message).toContain(`version ${String(SCORE_VERSION + 1)}`);
    expect(error.message).toContain(`up to version ${String(SCORE_VERSION)}`);
  });

  it.each([
    [
      'a missing version',
      { version: undefined },
      'version: Expected a whole number, found nothing',
    ],
    ['a fractional version', { version: 1.5 }, 'version: Expected a whole number, found 1.5'],
    ['a string version', { version: '1' }, 'version: Expected a whole number, found "1"'],
    ['another format', { format: 'gp' }, 'format: Expected "reprise", found "gp"'],
    ['an object format', { format: {} }, 'format: Expected "reprise", found an object'],
    [
      'a long format',
      { format: 'x'.repeat(100) },
      `format: Expected "reprise", found "${'x'.repeat(40)}…"`,
    ],
  ])('rejects %s', (_, override, message) => {
    expect(parseError(bytesOf({ ...envelope(createEmptyScore()), ...override })).message).toBe(
      message,
    );
  });

  it('names a number JSON cannot hold rather than the null it parses to', () => {
    const text = decode(serializeNative(createEmptyScore(), APP)).replace(
      '"version": 1,',
      '"version": 1e400,',
    );
    expect(parseError(encode(text)).message).toBe(
      'version: Expected a whole number, found Infinity',
    );
  });

  it('rejects bytes that are not UTF-8, JSON, or an object', () => {
    expect(parseError(new Uint8Array([0x7b, 0xff, 0x7d])).message).toBe(
      'The file is not valid UTF-8',
    );
    expect(parseError(encode('{"format": ')).message).toMatch(/^The file is not JSON/);
    expect(parseError(encode('[]')).message).toBe('The file is not a JSON object');
  });

  it('names the path of an invalid score field', () => {
    const score = buildFullScore();
    const beat = score.tracks[0]?.bars[0]?.voices[0]?.beats[0];
    if (!beat) throw new Error('the fixture has no first beat');
    Reflect.set(beat, 'duration', 3);
    const error = parseError(bytesOf(envelope(score)));
    expect(error.path).toEqual([
      'score',
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
    expect(error.message.startsWith('score.tracks[0].bars[0].voices[0].beats[0].duration: ')).toBe(
      true,
    );
  });

  it('rejects a document without app information', () => {
    const withoutApp = envelope(createEmptyScore());
    Reflect.deleteProperty(withoutApp, 'app');
    expect(parseError(bytesOf(withoutApp)).path).toEqual(['app']);
  });
});

describe('parseNative warnings', () => {
  it('reports unknown fields named like Object.prototype members, and __proto__ itself', () => {
    const score = createEmptyScore();
    const text = decode(serializeNative(score, APP))
      .replace(
        '"score": {',
        '"score": {\n    "toString": 1,\n    "__proto__": { "polluted": true },',
      )
      .replace('"meta": {', '"meta": {\n      "constructor": 2,');
    const result = parseNative(encode(text));
    expect(result.score).toEqual(score);
    expect(result.warnings.map((warning) => warning.path)).toEqual([
      ['score', 'toString'],
      ['score', '__proto__'],
      ['score', 'meta', 'constructor'],
    ]);
    expect(Object.getPrototypeOf(result.score)).toBe(Object.prototype);
    expect(Reflect.get({}, 'polluted')).toBeUndefined();
  });

  it('drops an unknown top-level field with a warning', () => {
    const score = createEmptyScore();
    const result = parseNative(bytesOf({ ...envelope(score), thumbnail: 'data:...' }));
    expect(result.score).toEqual(score);
    expect(result.warnings).toEqual([
      {
        rule: 'unknown-field',
        path: ['thumbnail'],
        message: 'Unknown field "thumbnail" was dropped',
      },
    ]);
  });

  it('drops unknown fields inside the score, naming their paths', () => {
    const score = createEmptyScore();
    const [track] = score.tracks;
    const [bar] = track?.bars ?? [];
    const raw = {
      ...envelope(score),
      score: {
        ...score,
        meta: { ...score.meta, rating: 5 },
        tracks: [{ ...track, bars: [{ ...bar, legacy: true }] }],
      },
    };
    const result = parseNative(bytesOf(raw));
    expect(result.score).toEqual(score);
    expect(result.warnings.map((warning) => warning.path)).toEqual([
      ['score', 'meta', 'rating'],
      ['score', 'tracks', 0, 'bars', 0, 'legacy'],
    ]);
  });

  it('reports invariant violations as warnings from the document root, not as failures', () => {
    const score = createEmptyScore();
    const voice = score.tracks[0]?.bars[0]?.voices[0];
    if (!voice) throw new Error('the empty score has no first voice');
    voice.beats.push(createBeat({ duration: 1 }), createBeat({ duration: 1 }));
    voice.beats.push(
      createBeat({ duration: 4, notes: [createNote({ string: 1, fret: 0, tie: true })] }),
    );
    const violations = validateScore(score);
    expect(violations.map((violation) => violation.rule)).toEqual(['voice-overfull', 'tie-target']);
    const result = parseNative(serializeNative(score, APP));
    expect(result.score).toEqual(score);
    expect(result.warnings).toEqual(
      violations.map(({ rule, path, message }) => ({ rule, path: ['score', ...path], message })),
    );
  });
});

describe('migrations', () => {
  it('has a step for every version up to the current one', () => {
    for (let version = 1; version <= SCORE_VERSION; version++) {
      expect(MIGRATIONS[version]).toBeTypeOf('function');
    }
  });

  it('applies the steps after the file version in order', () => {
    const table = {
      1: (score: unknown) => score,
      2: (score: unknown) => ({ step2: score }),
      3: (score: unknown) => ({ step3: score }),
    };
    expect(migrate('v1', 1, 3, table)).toEqual({ step3: { step2: 'v1' } });
    expect(migrate('v2', 2, 3, table)).toEqual({ step3: 'v2' });
    expect(migrate('v3', 3, 3, table)).toBe('v3');
  });

  it('fails when a step is missing', () => {
    expect(() => migrate({}, 1, 2, { 1: (score: unknown) => score })).toThrow(
      'No migration produces .reprise version 2',
    );
  });

  it('surfaces a failing step through parseNative as a NativeFormatError naming the versions', async () => {
    vi.resetModules();
    vi.doMock('./migrations', () => ({
      migrate: () => {
        throw new TypeError('bars is not iterable');
      },
    }));
    const { parseNative: parseWithFailingStep } = await import('./native');
    vi.doUnmock('./migrations');
    let error: unknown;
    try {
      parseWithFailingStep(serializeNative(createEmptyScore(), APP));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.name).toBe('NativeFormatError');
      expect(error.message).toBe(
        `score: Migrating from version ${String(SCORE_VERSION)} to ${String(SCORE_VERSION)} failed: bars is not iterable`,
      );
    }
  });
});

describe('formatPath', () => {
  it('joins keys with dots and indexes with brackets', () => {
    expect(formatPath(['score', 'tracks', 0, 'bars', 12, 'id'])).toBe(
      'score.tracks[0].bars[12].id',
    );
    expect(formatPath([])).toBe('');
  });
});
