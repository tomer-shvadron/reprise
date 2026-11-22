/**
 * Fails when a component file in the web app names a raw colour: a hex, rgb(), hsl() or oklch()
 * literal, a CSS colour keyword in a colour property, or a Tailwind palette class such as `bg-emerald-500`
 * (the palette names are read from the installed Tailwind). Colours live in the tokens of
 * `apps/web/src/index.css` and components use them (`bg-success`, `var(--color-primary)`). The
 * neutral `white` and `black` utilities stay, for scrims and the slider thumb.
 *
 *   pnpm colors:check                    # every tracked web source file, plus stale ALLOWED entries
 *   node scripts/colors/check.ts <file>  # the given files
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
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
  // Export as image writes a standalone SVG or PNG: no stylesheet travels with it to resolve a
  // token. It also holds the mask's black, which is an alpha channel, not a theme colour.
  'apps/web/src/features/score/image/palette.ts',
  // The swatches a track's colour is picked from; the choice is stored in the song, in any theme.
  'apps/web/src/features/editor/track-colors.ts',
];

export type Kind = 'literal' | 'palette-class' | 'named-colour';

export interface Finding {
  line: number;
  kind: Kind;
  text: string;
}

/** The palette names Tailwind ships, read from the installed `theme.css` so an upgrade cannot leave a list behind. */
export function tailwindPalettes(theme: string): string[] {
  const names = new Set<string>();
  for (const [, name] of theme.matchAll(/--color-([a-z]+)-500\s*:/g)) {
    if (name !== undefined) names.add(name);
  }
  if (names.size < 10) throw new Error('tailwindcss/theme.css names too few colour palettes');
  return [...names].sort();
}

function installedPalettes(): string[] {
  const require = createRequire(join(ROOT, 'apps/web/package.json'));
  return tailwindPalettes(readFileSync(require.resolve('tailwindcss/theme.css'), 'utf8'));
}

// `_` is a space inside a Tailwind arbitrary value (`shadow-[0_0_0_1px_#000]`), so it must not
// count as part of a word before a colour.
const HEX = /(?<![A-Za-z0-9&/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b/i;
const FUNCTION = /(?<![A-Za-z0-9-])(?:rgba?|hsla?|oklch|oklab|lch|lab|hwb)\(/i;
// A CSS colour keyword in a colour property or attribute, never a bare word: 'white' is also an enum,
// so a quoted `background: 'white'` (an object key) passes while CSS `background: white` does not.
const KEYWORDS =
  'black|white|red|green|blue|yellow|orange|purple|pink|gray|grey|teal|cyan|magenta|lime|navy|maroon|olive|silver|aqua|fuchsia|brown|gold|coral|salmon|crimson|indigo|violet';
const NAMED = new RegExp(
  String.raw`(?:\bbackground\s*:\s*(?=[a-z])|\b(?:fill|stroke|color|background-color|border(?:-[a-z]+)?-color|stop-color)\s*[=:]\s*\\?["']?|setAttribute\(\s*["'](?:fill|stroke|color|stop-color)["']\s*,\s*["'])(?:${KEYWORDS})\b`,
  'i',
);

/** A Tailwind utility ending in a palette colour and a shade: `bg-red-500`, `border-t-slate-200`. */
function paletteClass(palettes: readonly string[]): RegExp {
  return new RegExp(
    String.raw`(?<![A-Za-z0-9])[a-z][a-z-]*-(?:${palettes.join('|')})-(?:50|[1-9]00|950)\b`,
  );
}

/**
 * Blanks every comment, keeping the line count and what is inside strings. `//` starts a comment
 * only outside a string, so `'a//b'` hides nothing; CSS has only `/* *\/` comments.
 */
export function withoutComments(source: string, css = false): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const char = source.charAt(i);
    const next = source.charAt(i + 1);
    if (quote !== '') {
      out += char;
      if (char === '\\' && !css) {
        out += next;
        i++;
      } else if (char === quote || (char === '\n' && quote !== '`')) quote = '';
    } else if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else if (char === '/' && next === '/' && !css && source.charAt(i - 1) !== ':') {
      while (i < source.length && source.charAt(i) !== '\n') {
        out += ' ';
        i++;
      }
      i--;
    } else {
      if (char === '"' || char === "'" || (char === '`' && !css)) quote = char;
      out += char;
    }
  }
  return out;
}

export function findRawColors(
  source: string,
  options: { css?: boolean; palettes?: readonly string[] } = {},
): Finding[] {
  const palette = paletteClass(options.palettes ?? installedPalettes());
  const original = source.split('\n');
  const findings: Finding[] = [];
  withoutComments(source, options.css)
    .split('\n')
    .forEach((text, index) => {
      const kind: Kind | undefined =
        HEX.test(text) || FUNCTION.test(text)
          ? 'literal'
          : palette.test(text)
            ? 'palette-class'
            : NAMED.test(text)
              ? 'named-colour'
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
  const palettes = installedPalettes();
  const problems: string[] = [];
  let checked = 0;
  for (const path of tracked) {
    if (!inScope(path) || isAllowed(path)) continue;
    checked += 1;
    for (const { line, kind, text } of findRawColors(readFileSync(join(ROOT, path), 'utf8'), {
      css: path.endsWith('.css'),
      palettes,
    })) {
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
