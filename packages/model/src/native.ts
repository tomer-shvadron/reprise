import { z } from 'zod';

import { migrate } from './migrations';
import { SCORE_VERSION, ScoreSchema } from './score';
import type { Score } from './score';
import { validateScore } from './validate';
import type { ViolationRule } from './validate';

// Declared locally rather than through the DOM or Node lib so the package stays lib-free;
// both runtimes provide the globals.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };
declare const TextDecoder: new (
  label: 'utf-8',
  options: { fatal: boolean },
) => { decode(input: Uint8Array): string };

export const NATIVE_FORMAT = 'reprise';
export const NATIVE_EXTENSION = '.reprise';

export const AppInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});
/** The app that wrote the file, for diagnostics; it never changes how a file is read. */
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const NativeDocumentSchema = z.object({
  format: z.literal(NATIVE_FORMAT),
  version: z.literal(SCORE_VERSION),
  app: AppInfoSchema,
  score: ScoreSchema,
});
export type NativeDocument = z.infer<typeof NativeDocumentSchema>;

export type NativePath = (string | number)[];

export type ParseWarningRule = 'unknown-field' | ViolationRule;

/** `path` is from the document root, so a score violation starts with `score`. */
export interface ParseWarning {
  rule: ParseWarningRule;
  path: NativePath;
  message: string;
}

export interface ParseResult {
  score: Score;
  app: AppInfo;
  warnings: ParseWarning[];
}

export class NativeFormatError extends Error {
  override readonly name = 'NativeFormatError';
  readonly path: NativePath;

  constructor(path: NativePath, message: string) {
    super(path.length > 0 ? `${formatPath(path)}: ${message}` : message);
    this.path = path;
  }
}

export function formatPath(path: NativePath): string {
  let text = '';
  for (const segment of path) {
    text += typeof segment === 'number' ? `[${String(segment)}]` : text ? `.${segment}` : segment;
  }
  return text;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Rebuilds `value` with every object's keys sorted, so the bytes depend only on content.
 * `Score` has no integer-like keys, which JavaScript would order ahead of the rest.
 */
function canonical(value: unknown): Json {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => value[key] !== undefined)
        .map((key) => [key, canonical(value[key])]),
    );
  }
  throw new TypeError(`A score cannot hold a ${typeof value}`);
}

/**
 * Two-space-indented UTF-8 JSON with a trailing newline. The envelope keeps its documented
 * order so `format` comes first; everything inside `app` and `score` is key-sorted. The
 * envelope is validated first and the validated copy is what gets written, so a file this
 * function produces always reads back without warnings; an invalid score throws
 * `NativeFormatError` naming the path.
 */
export function serializeNative(score: Score, app: AppInfo): Uint8Array {
  const document = parseDocument({ format: NATIVE_FORMAT, version: SCORE_VERSION, app, score });
  const ordered = {
    format: document.format,
    version: document.version,
    app: canonical(document.app),
    score: canonical(document.score),
  };
  return new TextEncoder().encode(`${JSON.stringify(ordered, null, 2)}\n`);
}

/**
 * Reads a `.reprise` file of this or an older version. Throws `NativeFormatError`, naming the
 * offending path, for anything it cannot turn into a schema-valid `Score`. Fields it does not
 * know are dropped, and those and the score's invariant violations are reported in `warnings`.
 */
export function parseNative(bytes: Uint8Array): ParseResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new NativeFormatError([], 'The file is not valid UTF-8');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new NativeFormatError([], `The file is not JSON (${reason})`);
  }
  if (!isRecord(raw)) throw new NativeFormatError([], 'The file is not a JSON object');

  if (raw['format'] !== NATIVE_FORMAT) {
    throw new NativeFormatError(
      ['format'],
      `Expected "${NATIVE_FORMAT}", found ${show(raw['format'])}`,
    );
  }

  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new NativeFormatError(['version'], `Expected a whole number, found ${show(version)}`);
  }
  if (version < 1) {
    throw new NativeFormatError(
      ['version'],
      `Version ${String(version)} does not exist; .reprise versions start at 1`,
    );
  }
  if (version > SCORE_VERSION) {
    throw new NativeFormatError(
      ['version'],
      `The file is version ${String(version)}, newer than this app, which reads up to version ${String(SCORE_VERSION)}`,
    );
  }

  const candidate = {
    ...raw,
    version: SCORE_VERSION,
    score: migrate(raw['score'], version),
  };
  const document = parseDocument(candidate);

  const warnings: ParseWarning[] = [];
  collectDropped(candidate, document, [], warnings);
  for (const { rule, path, message } of validateScore(document.score)) {
    warnings.push({ rule, path: ['score', ...path], message });
  }
  return { score: document.score, app: document.app, warnings };
}

function parseDocument(candidate: unknown): NativeDocument {
  const result = NativeDocumentSchema.safeParse(candidate);
  if (result.success) return result.data;
  const [first, ...rest] = result.error.issues;
  const path = (first?.path ?? []).filter(
    (segment): segment is string | number => typeof segment !== 'symbol',
  );
  const more = rest.length > 0 ? ` (and ${String(rest.length)} more)` : '';
  throw new NativeFormatError(path, `${first?.message ?? 'Invalid document'}${more}`);
}

/** Zod strips keys it does not know; walking input and output side by side finds them. */
function collectDropped(
  input: unknown,
  output: unknown,
  path: NativePath,
  warnings: ParseWarning[],
): void {
  if (Array.isArray(input) && Array.isArray(output)) {
    for (const [index, item] of input.entries()) {
      collectDropped(item, output[index], [...path, index], warnings);
    }
    return;
  }
  if (!isRecord(input) || !isRecord(output)) return;
  for (const [key, value] of Object.entries(input)) {
    if (key in output) {
      collectDropped(value, output[key], [...path, key], warnings);
    } else {
      warnings.push({
        rule: 'unknown-field',
        path: [...path, key],
        message: `Unknown field "${key}" was dropped`,
      });
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function show(value: unknown): string {
  return value === undefined ? 'nothing' : JSON.stringify(value);
}
