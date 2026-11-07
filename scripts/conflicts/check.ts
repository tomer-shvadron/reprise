/**
 * Fails on merge conflict markers in text files, including the forms Prettier leaves after it has
 * rewritten them in Markdown and HTML, which `prettier --check` then accepts.
 *
 *   pnpm conflicts:check                    # every tracked file, plus stale ALLOWED entries
 *   node scripts/conflicts/check.ts <file>  # the given files (the pre-commit hook)
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process, { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = join(import.meta.dirname, '../..');

/**
 * Files that must hold marker text, as repo-relative POSIX paths; an entry ending in `/` covers
 * that directory. Each entry carries a comment saying why.
 */
export const ALLOWED: readonly string[] = [];

export type Rule =
  'raw' | 'markdown-nested' | 'markdown-quote-run' | 'markdown-table-run' | 'html-inline';

export interface Finding {
  line: number;
  rule: Rule;
  text: string;
}

// git's is_conflict_marker: exactly seven of one character, then whitespace or the end of the line.
const MARKER = String.raw`(?:<{7}|={7}|>{7}|\|{7})(?=\s|$)`;
const MARKDOWN = /\.(?:md|mdx|markdown)$/i;
const HTML = /\.html?$/i;

const RULES: readonly { rule: Rule; applies: (path: string) => boolean; pattern: RegExp }[] = [
  { rule: 'raw', applies: () => true, pattern: new RegExp(`^${MARKER}`) },
  {
    // Inside a table row, a list item or a quote, behind a heading's #, or escaped as \=======.
    rule: 'markdown-nested',
    applies: (path) => MARKDOWN.test(path),
    pattern: new RegExp(
      String.raw`^[ \t]*(?:[>|][ \t]*)*(?:(?:#{1,6}|[-*+]|\d{1,9}[.)])[ \t]+)?\\?` + MARKER,
    ),
  },
  {
    // >>>>>>> read as seven nested quotes, which Prettier spaces out.
    rule: 'markdown-quote-run',
    applies: (path) => MARKDOWN.test(path),
    pattern: /^[ \t]*(?:>[ \t]*){6}>(?=\s|$)/,
  },
  {
    // A diff3 ||||||| read as a table row whose first six cells are empty.
    rule: 'markdown-table-run',
    applies: (path) => MARKDOWN.test(path),
    pattern: /^[ \t]*(?:>[ \t]*)*\|(?:[ \t]*\|){6}/,
  },
  {
    // Prettier indents markers between elements and joins those inside one onto a single line.
    rule: 'html-inline',
    applies: (path) => HTML.test(path),
    pattern: /(?<!<)<{7}(?=\s|$)|(?<!=)={7}(?=\s|$)|(?<!>)>{7}(?=\s|$)|(?<!\|)\|{7}(?=\s|$)/,
  },
];

/** One finding per line, the first rule that matches; a run of quote-run lines reports its first. */
export function findMarkers(path: string, text: string): Finding[] {
  const rules = RULES.filter(({ applies }) => applies(path));
  const findings: Finding[] = [];
  let previous: Rule | undefined;
  for (const [index, line] of text.split('\n').entries()) {
    const rule = rules.find(({ pattern }) => pattern.test(line))?.rule;
    if (rule && !(rule === 'markdown-quote-run' && previous === rule)) {
      findings.push({ line: index + 1, rule, text: line.trim() });
    }
    previous = rule;
  }
  return findings;
}

/** git's own test for a binary file: a NUL byte in the first 8000 bytes. */
export function isBinary(content: Uint8Array): boolean {
  return content.subarray(0, 8000).includes(0);
}

export function isAllowed(path: string, allowed: readonly string[] = ALLOWED): boolean {
  return allowed.some((entry) => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
}

/** Entries that match no tracked file, so the list cannot rot. */
export function staleEntries(
  tracked: readonly string[],
  allowed: readonly string[] = ALLOWED,
): string[] {
  return allowed.filter((entry) => !tracked.some((path) => isAllowed(path, [entry])));
}

/** Findings for one repo-relative path, or `undefined` when it is skipped. */
function checkFile(path: string): Finding[] | undefined {
  if (isAllowed(path)) return undefined;
  const absolute = join(ROOT, path);
  // A deleted file, a symlink or a submodule.
  if (!lstatSync(absolute, { throwIfNoEntry: false })?.isFile()) return undefined;
  const content = readFileSync(absolute);
  if (isBinary(content)) return undefined;
  return findMarkers(path, content.toString('utf8'));
}

function main(): void {
  const files = argv.slice(2);
  const tracked =
    files.length > 0
      ? files.map((file) => relative(ROOT, resolve(file)).split(sep).join('/'))
      : execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
          .split('\0')
          .filter(Boolean);
  const problems: string[] = [];
  let checked = 0;
  for (const path of tracked) {
    const findings = checkFile(path);
    if (findings === undefined) continue;
    checked += 1;
    for (const { line, rule, text } of findings) {
      problems.push(`${path}:${String(line)}: ${text.slice(0, 80)} (${rule})`);
    }
  }
  if (files.length === 0) {
    for (const entry of staleEntries(tracked)) {
      problems.push(`ALLOWED entry ${entry} matches no tracked file`);
    }
  }
  if (problems.length === 0) {
    console.log(`No conflict markers in ${String(checked)} text files.`);
    return;
  }
  for (const problem of problems) console.error(problem);
  console.error(
    `${String(problems.length)} conflict marker problem(s). \`pnpm conflicts:check\` lists every tracked file's; a file that must hold marker text goes in ALLOWED in scripts/conflicts/check.ts, with its reason.`,
  );
  process.exitCode = 1;
}

// Not import.meta.main: it arrived in Node 24.2, and on 24.0 and 24.1 the hook would pass silently.
const entry = argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
