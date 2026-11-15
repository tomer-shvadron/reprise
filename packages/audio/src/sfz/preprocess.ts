import { dirname, resolvePath } from './paths';
import { LIMITS, bump } from './report';
import type { SfzReport } from './report';

export const MAX_INCLUDE_DEPTH = 16;

/**
 * Reads one pack file. `path` is literal and already confined: '/'-separated, relative to the pack
 * root, free of `..`, absolute forms, percent-encoded separators, control characters and Windows
 * device names. A reader must not URL-decode it, resolve it against anything but the pack root, or
 * follow symlinks out of the root; WP-091's reader enforces the last two.
 */
export type SfzReader = (path: string) => Promise<Uint8Array>;

export class SfzParseError extends Error {
  override readonly name = 'SfzParseError';
}

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /\/\/.*$/;
const INCLUDE = /^\s*#include\s+"([^"]+)"/i;
const DEFINE = /^\s*#define\s+(\$[A-Za-z0-9_]+)\s*(.*)$/i;

function decode(bytes: Uint8Array): string {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.startsWith(String.fromCodePoint(0xfe_ff)) ? text.slice(1) : text;
}

/**
 * The text of a root SFZ file with comments removed, `#include` expanded and `#define` variables
 * substituted, in order: a define applies from its line on, across included files. Includes are
 * read through `read` and resolved against the root file's directory, nest at most
 * `MAX_INCLUDE_DEPTH` deep, and a cycle, a missing file or an escaping path is reported and
 * skipped. Pack files are untrusted, so the work is capped (`LIMITS`): past a cap the expansion
 * stops, the report says so, and what was read so far is returned. Only an unreadable root throws.
 */
export async function preprocess(
  rootPath: string,
  read: SfzReader,
  report: SfzReport,
): Promise<string> {
  const root = resolvePath('', rootPath);
  if (root === undefined) throw new SfzParseError(`The SFZ path ${rootPath} leaves the pack`);
  const base = dirname(root);
  const defines = new Map<string, string>();
  const out: string[] = [];
  let length = 0;
  let reads = 0;
  let stopped = false;

  const stop = (reason: string): void => {
    if (!stopped) report.limits.push(reason);
    stopped = true;
  };

  /** The line with its `$NAME`s replaced, longest name first, or `undefined` past the text cap. */
  const substitute = (line: string): string | undefined => {
    if (defines.size === 0 || !line.includes('$')) return line;
    const names = [...defines.keys()].sort((a, b) => b.length - a.length);
    const parts: string[] = [];
    let size = 0;
    let at = 0;
    while (at < line.length) {
      const dollar = line.indexOf('$', at);
      const plain = dollar === -1 ? line.slice(at) : line.slice(at, dollar);
      parts.push(plain);
      size += plain.length;
      if (dollar === -1) break;
      const name = names.find((candidate) => line.startsWith(candidate, dollar));
      const piece = name === undefined ? '$' : (defines.get(name) ?? '');
      parts.push(piece);
      size += piece.length;
      if (size > LIMITS.textLength) return undefined;
      at = dollar + (name?.length ?? 1);
    }
    return parts.join('');
  };

  const visit = async (path: string, stack: readonly string[]): Promise<void> => {
    if (reads >= LIMITS.includeReads) {
      stop(`include reads (more than ${String(LIMITS.includeReads)} files)`);
      return;
    }
    reads += 1;
    let bytes: Uint8Array;
    try {
      bytes = await read(path);
    } catch (error) {
      if (stack.length === 0) {
        throw new SfzParseError(`Cannot read ${path}`, { cause: error });
      }
      report.unresolvedIncludes.push(path);
      return;
    }
    const text = decode(bytes).replace(BLOCK_COMMENT, '');
    for (const raw of text.split(/\r?\n/)) {
      if (stopped) return;
      const line = raw.replace(LINE_COMMENT, '');
      const include = INCLUDE.exec(line);
      if (include) {
        const name = substitute(include[1] ?? '');
        const target = name === undefined ? undefined : resolvePath(base, name);
        if (name === undefined) {
          stop('text length (an include path)');
        } else if (target === undefined) {
          report.escapedPaths.push(include[1] ?? '');
        } else if (stack.includes(target) || target === path) {
          report.unresolvedIncludes.push(`${target} (cycle)`);
        } else if (stack.length >= MAX_INCLUDE_DEPTH) {
          report.unresolvedIncludes.push(`${target} (depth)`);
        } else {
          await visit(target, [...stack, path]);
        }
        continue;
      }
      const define = DEFINE.exec(line);
      if (define) {
        const value = substitute((define[2] ?? '').trim());
        if (value === undefined || value.length > LIMITS.defineLength) {
          stop(`define length (a #define value over ${String(LIMITS.defineLength)} characters)`);
          return;
        }
        defines.set(define[1] ?? '', value);
        bump(report.used, '#define');
        continue;
      }
      const expanded = substitute(line);
      if (expanded === undefined || length + expanded.length > LIMITS.textLength) {
        stop(`text length (more than ${String(LIMITS.textLength)} characters)`);
        return;
      }
      length += expanded.length + 1;
      out.push(expanded);
    }
  };

  await visit(root, []);
  return out.join('\n');
}
