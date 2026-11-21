import { detect, read, write, type Format, type Warning } from '@reprise/formats';
import type { Score } from '@reprise/model';

import { applyNotationDefaults, type NotationDefaults } from '@/state/notation-defaults';

/** What the library row needs from a score, without the score itself. */
export interface ScoreSummary {
  title: string;
  artist: string;
  album: string;
  bars: number;
  tracks: { name: string }[];
}

export function summarize(score: Score): ScoreSummary {
  const { title, artist, album } = score.meta;
  return {
    title,
    artist,
    album,
    bars: score.masterBars.length,
    tracks: score.tracks.map((track) => ({ name: track.name })),
  };
}

export interface ParsedImport {
  format: Format;
  /** The song as `.reprise` bytes. A `.reprise` source keeps its own bytes. */
  native: Uint8Array;
  meta: ScoreSummary;
  warnings: Warning[];
  /** SHA-256 hex of the source bytes, the library's duplicate key. */
  key: string;
}

export type Failure = { ok: false; code: string; message: string };
export type ParseOutcome = { ok: true; parsed: ParsedImport } | Failure;
export type NativeOutcome = { ok: true; native: Uint8Array } | Failure;

function failureOf(error: unknown): Failure {
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'read-failed';
  return { ok: false, code, message: error instanceof Error ? error.message : String(error) };
}

/** The score as `.reprise` bytes; for a score the app opened, whose track ids must be kept. */
export async function nativeOf(score: Score): Promise<NativeOutcome> {
  try {
    return { ok: true, native: (await write(score, 'reprise')).bytes };
  } catch (error) {
    return failureOf(error);
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // A copy into a plain ArrayBuffer, since `digest` refuses a view over a SharedArrayBuffer.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * detect, read, write native, summarize and hash, as one pure step. It runs in the parse worker
 * (or inline where there is no `Worker`), so a batch never blocks a frame on a real song.
 */
export async function parseImport(
  bytes: Uint8Array,
  fallbackTitle = '',
  defaults?: NotationDefaults,
): Promise<ParseOutcome> {
  try {
    const format = detect(bytes);
    if (format === undefined) {
      return { ok: false, code: 'unknown-format', message: 'Not a Guitar Pro or Reprise file' };
    }
    const [result, key] = await Promise.all([read(bytes), sha256Hex(bytes)]);
    const { warnings } = result;
    const score = defaults
      ? applyNotationDefaults(result.score, result.implicitNotation, defaults)
      : result.score;
    const native = format === 'reprise' ? bytes : (await write(score, 'reprise')).bytes;
    const meta = summarize(score);
    if (meta.title.trim() === '') meta.title = fallbackTitle;
    return { ok: true, parsed: { format, native, meta, warnings, key } };
  } catch (error) {
    return failureOf(error);
  }
}
