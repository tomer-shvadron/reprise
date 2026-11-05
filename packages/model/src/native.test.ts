import { describe, expect, it, vi } from 'vitest';

import { createBeat, createEmptyScore, createNote } from './factories';
import { fullScore, largeScore } from './testing';
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

/** Paths of every object whose keys are not in sorted order, arrays walked in place. */
function unsortedObjects(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => unsortedObjects(item, `${path}[${String(index)}]`));
  }
  if (typeof value !== 'object' || value === null) return [];
  const keys = Object.keys(value);
  const here = keys.join() === [...keys].sort().join() ? [] : [path];
  return [
    ...here,
    ...keys.flatMap((key) => unsortedObjects(Reflect.get(value, key), `${path}.${key}`)),
  ];
}

// Date.now() because the package's lib has no `performance`; millisecond resolution is enough.
function timed<T>(run: () => T): [T, number] {
  const start = Date.now();
  const result = run();
  return [result, Date.now() - start];
}

describe('round trip', () => {
  const scores: [string, () => Score][] = [
    ['the empty score', createEmptyScore],
    ['a score using every node type and optional field', fullScore],
    ['a large generated score', () => largeScore(6, 200, { structure: true })],
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

// Measured at 40 to 50 ms each on the 200-bar, 6-track score; the bounds only catch a
// quadratic regression.
describe('a large score', () => {
  it('serialises and parses in linear time', () => {
    const score = largeScore(6, 200, { structure: true });
    const [bytes, serializeMs] = timed(() => serializeNative(score, APP));
    const [result, parseMs] = timed(() => parseNative(bytes));
    expect(result.score).toEqual(score);
    expect(serializeMs).toBeLessThan(1000);
    expect(parseMs).toBeLessThan(2000);
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
    const score = fullScore();
    expect(serializeNative(score, APP)).toEqual(serializeNative(score, APP));
  });

  it('does not depend on the order keys were inserted in', () => {
    const score = fullScore();
    const shuffled = ScoreSchema.parse(JSON.parse(JSON.stringify(score)));
    reverseKeysInPlace(shuffled);
    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(score));
    expect(decode(serializeNative(shuffled, APP))).toBe(decode(serializeNative(score, APP)));
  });

  it('sorts keys inside the score and keeps array order', () => {
    const score = fullScore();
    const written: unknown = JSON.parse(decode(serializeNative(score, APP)));
    expect(keysOf(at(written, 'score'))).toEqual(['id', 'masterBars', 'meta', 'tracks']);
    expect(keysOf(at(written, 'score', 'meta'))).toEqual(Object.keys(score.meta).sort());
    expect(unsortedObjects(at(written, 'app'), 'app')).toEqual([]);
    expect(unsortedObjects(at(written, 'score'), 'score')).toEqual([]);
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
      expect(error.code).toBe('invalid-document');
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
    expect(error.code).toBe('invalid-version');
    expect(error.path).toEqual(['version']);
    expect(error.message).toBe('version: Version 0 does not exist; .reprise versions start at 1');
  });

  it('rejects a document newer than this app, naming both versions', () => {
    const error = parseError(
      bytesOf({ ...envelope(createEmptyScore()), version: SCORE_VERSION + 1 }),
    );
    expect(error.code).toBe('newer-version');
    expect(error.path).toEqual(['version']);
    expect(error.message).toContain('newer than this app');
    expect(error.message).toContain(`version ${String(SCORE_VERSION + 1)}`);
    expect(error.message).toContain(`up to version ${String(SCORE_VERSION)}`);
  });

  it.each([
    [
      'a missing version',
      { version: undefined },
      'invalid-version',
      'version: Expected a whole number, found nothing',
    ],
    [
      'a fractional version',
      { version: 1.5 },
      'invalid-version',
      'version: Expected a whole number, found 1.5',
    ],
    [
      'a string version',
      { version: '1' },
      'invalid-version',
      'version: Expected a whole number, found "1"',
    ],
    ['another format', { format: 'gp' }, 'wrong-format', 'format: Expected "reprise", found "gp"'],
    [
      'an object format',
      { format: {} },
      'wrong-format',
      'format: Expected "reprise", found an object',
    ],
    [
      'a long format',
      { format: 'x'.repeat(100) },
      'wrong-format',
      `format: Expected "reprise", found "${'x'.repeat(40)}…"`,
    ],
  ] as const)('rejects %s', (_, override, code, message) => {
    const error = parseError(bytesOf({ ...envelope(createEmptyScore()), ...override }));
    expect(error.code).toBe(code);
    expect(error.message).toBe(message);
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

  it('rejects bytes that are not UTF-8, JSON, or an object, each under its code', () => {
    const utf8 = parseError(new Uint8Array([0x7b, 0xff, 0x7d]));
    expect(utf8).toMatchObject({ code: 'invalid-utf8', message: 'The file is not valid UTF-8' });
    const json = parseError(encode('{"format": '));
    expect(json.code).toBe('invalid-json');
    expect(json.message).toMatch(/^The file is not JSON/);
    const array = parseError(encode('[]'));
    expect(array).toMatchObject({
      code: 'invalid-document',
      message: 'The file is not a JSON object',
    });
  });

  it('reads a file with a leading BOM, without the trailing newline, or with CRLF', () => {
    const score = createEmptyScore();
    const bytes = serializeNative(score, APP);
    const text = decode(bytes);
    expect(parseNative(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes])).score).toEqual(score);
    expect(parseNative(encode(text.trimEnd())).score).toEqual(score);
    expect(parseNative(encode(text.replaceAll('\n', '\r\n'))).score).toEqual(score);
  });

  it('treats null as a value, never as a missing optional field', () => {
    const text = decode(serializeNative(createEmptyScore(), APP)).replace(
      /"tempo": \{[^}]*\}/,
      '"tempo": null',
    );
    const error = parseError(encode(text));
    expect(error.path).toEqual(['score', 'masterBars', 0, 'tempo']);
  });

  it('names the path of an invalid score field', () => {
    const score = fullScore();
    const beat = score.tracks[0]?.bars[0]?.voices[0]?.beats[0];
    if (!beat) throw new Error('the fixture has no first beat');
    Reflect.set(beat, 'duration', 3);
    const error = parseError(bytesOf(envelope(score)));
    expect(error.code).toBe('invalid-document');
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
        code: 'unknown-field',
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
      violations.map(({ rule, path, message }) => ({
        code: rule,
        path: ['score', ...path],
        message,
      })),
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
      expect(error).toMatchObject({ code: 'migration-failed' });
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
