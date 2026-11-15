import { dirname, resolvePath } from './paths';
import { bump } from './report';
import type { SfzReport } from './report';

export const MAX_INCLUDE_DEPTH = 16;

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
 * skipped. Only an unreadable root throws.
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

  const substitute = (line: string): string => {
    if (defines.size === 0 || !line.includes('$')) return line;
    const names = [...defines.keys()].sort((a, b) => b.length - a.length);
    let result = line;
    for (const name of names) result = result.replaceAll(name, defines.get(name) ?? '');
    return result;
  };

  const visit = async (path: string, stack: readonly string[]): Promise<void> => {
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
      const line = raw.replace(LINE_COMMENT, '');
      const include = INCLUDE.exec(line);
      if (include) {
        const target = resolvePath(base, substitute(include[1] ?? ''));
        if (target === undefined) {
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
        defines.set(define[1] ?? '', substitute((define[2] ?? '').trim()));
        bump(report.used, '#define');
        continue;
      }
      out.push(substitute(line));
    }
  };

  await visit(root, []);
  return out.join('\n');
}
