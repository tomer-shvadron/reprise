/**
 * Fails when a component file in the web app names a raw colour: a hex, rgb(), hsl() or oklch()
 * literal, or a Tailwind palette class such as `bg-emerald-500`. Colours live in the tokens of
 * `apps/web/src/index.css` and components use them (`bg-success`, `var(--color-primary)`). The
 * neutral `white` and `black` utilities stay, for scrims and the slider thumb.
 *
 *   pnpm colors:check                    # every tracked web source file, plus stale ALLOWED entries
 *   node scripts/colors/check.ts <file>  # the given files
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import process, { argv } from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = join(import.meta.dirname, '../..');

/** The web app's sources, the only place components live. */
const SCOPE = /^apps\/web\/src\/.+\.(?:ts|tsx|css)$/;
/** Tests and test helpers state colours as expectations, and index.css defines the tokens. */
const SKIPPED = /(?:\.test\.tsx?|\/test\/.+|^apps\/web\/src\/index\.css)$/;

/**
 * Files that must hold a literal colour, as repo-relative POSIX paths. Each carries its reason.
 */
export const ALLOWED: readonly string[] = [
  // Export as image writes a standalone SVG or PNG: no stylesheet travels with it to resolve a token.
  'apps/web/src/features/score/image/palette.ts',
  // The SVG mask's black and white are its alpha channel, not a theme colour.
  'apps/web/src/features/score/image/svg-page.ts',
  // The swatches a track's colour is picked from; the choice is stored in the song, in any theme.
  'apps/web/src/features/editor/track-form.ts',
];

export type Kind = 'literal' | 'palette-class';

export interface Finding {
  line: number;
  kind: Kind;
  text: string;
}

const HEX = /(?<![\w&/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const FUNCTION = /\b(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/i;
const PALETTE_CLASS =
  /\b(?:bg|text|border|ring|fill|stroke|from|via|to|outline|divide|shadow|accent|caret|decoration)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b/;

/** Comments name issues (`#352`) and say what a colour was; they are not colours. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

export function findRawColors(source: string): Finding[] {
  const findings: Finding[] = [];
  const original = source.split('\n');
  withoutComments(source)
    .split('\n')
    .forEach((text, index) => {
      const kind: Kind | undefined =
        HEX.test(text) || FUNCTION.test(text)
          ? 'literal'
          : PALETTE_CLASS.test(text)
            ? 'palette-class'
            : undefined;
      if (kind !== undefined) {
        findings.push({ line: index + 1, kind, text: (original[index] ?? text).trim() });
      }
    });
  return findings;
}

/** Whether `path` is a component file this check reads. */
export function inScope(path: string): boolean {
  return SCOPE.test(path) && !SKIPPED.test(path);
}

export function isAllowed(path: string, allowed: readonly string[] = ALLOWED): boolean {
  return allowed.includes(path);
}

/** Entries that match no tracked file, so the list cannot rot. */
export function staleEntries(
  tracked: readonly string[],
  allowed: readonly string[] = ALLOWED,
): string[] {
  return allowed.filter((entry) => !tracked.includes(entry));
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
    if (!inScope(path) || isAllowed(path)) continue;
    checked += 1;
    for (const { line, kind, text } of findRawColors(readFileSync(join(ROOT, path), 'utf8'))) {
      problems.push(`${path}:${String(line)}: ${text.slice(0, 80)} (${kind})`);
    }
  }
  if (files.length === 0) {
    for (const entry of staleEntries(tracked)) {
      problems.push(`ALLOWED entry ${entry} matches no tracked file`);
    }
  }
  if (problems.length === 0) {
    console.log(`No raw colours in ${String(checked)} web source files.`);
    return;
  }
  for (const problem of problems) console.error(problem);
  console.error(
    `${String(problems.length)} raw colour problem(s). Use a token from apps/web/src/index.css (add one there for a new colour); a file that must hold a literal goes in ALLOWED in scripts/colors/check.ts, with its reason.`,
  );
  process.exitCode = 1;
}

// Not import.meta.main: it arrived in Node 24.2, and on 24.0 and 24.1 the check would pass silently.
const entry = argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
