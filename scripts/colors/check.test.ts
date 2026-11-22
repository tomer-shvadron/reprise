import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ALLOWED,
  findRawColors,
  inScope,
  isAllowed,
  staleEntries,
  tailwindPalettes,
  withoutComments,
} from './check.ts';

const CLI = fileURLToPath(new URL('check.ts', import.meta.url));
const kinds = (source: string, css = false) =>
  findRawColors(source, { css }).map((finding) => finding.kind);

describe('findRawColors', () => {
  it.each([
    ["const a = '#15110d';", 'literal'],
    ['const a = "#fff";', 'literal'],
    ['x { color: #ff000080; }', 'literal'],
    ["const a = 'rgb(0 0 0)';", 'literal'],
    ['x { color: rgba(0, 0, 0, 0.5); }', 'literal'],
    ["style={{ color: 'hsl(10 20% 30%)' }}", 'literal'],
    ['x { color: oklch(0.5 0.1 20); }', 'literal'],
    ['className="bg-emerald-500/20"', 'palette-class'],
    ["const GREEN = 'text-emerald-700 dark:text-emerald-400';", 'palette-class'],
    ['className="fill-slate-900"', 'palette-class'],
    ['className="border-t-red-500 border-x-slate-200 ring-offset-red-500"', 'palette-class'],
    ['className="bg-mauve-500 text-olive-100 ring-mist-300 fill-taupe-950"', 'palette-class'],
    ['className="shadow-[0_0_0_1px_#000]"', 'literal'],
    ['className="shadow-[0_1px_2px_oklch(0_0_0/20%)]"', 'literal'],
    ['className="shadow-[0_0_0_1px_rgba(0,0,0,.1)]"', 'literal'],
    ["const u = 'a//b'; const c = '#fff';", 'literal'],
    ['<circle fill="red" />', 'named-colour'],
    ["style={{ color: 'red' }}", 'named-colour'],
    ["circle.setAttribute('fill', 'teal');", 'named-colour'],
    ['x { stroke: navy; }', 'named-colour'],
  ])('flags %s', (source, kind) => {
    expect(kinds(source)).toEqual([kind]);
  });

  it.each([
    ['className="bg-success text-muted-foreground"'],
    ["fill='var(--color-primary)'"],
    ['className="bg-black/40 dark:bg-black/60 bg-white"'],
    ['x { background: color-mix(in oklch, var(--paper-accent) 12%, transparent); }'],
    ['// the chord strip (#352) and #242'],
    ['/** Fixes #352, was rgb(0 0 0) */'],
    ['<a href="#main">'],
    ['<circle fill="none" stroke="currentColor" />'],
    ["background: 'white',"],
    ["const colour = 'white';"],
    ['className="border-t-border bg-success-foreground"'],
    ["const url = 'https://example.com/#abc';"],
  ])('passes %s', (source) => {
    expect(findRawColors(source)).toEqual([]);
  });

  it('reports the line of each finding and the original text', () => {
    const found = findRawColors("a\n  const x = '#abc'; // note\nb");
    expect(found).toEqual([{ line: 2, kind: 'literal', text: "const x = '#abc'; // note" }]);
  });

  it('ignores a multi-line comment but keeps its line count', () => {
    const found = findRawColors("/*\n #fff\n*/\nconst x = '#fff';");
    expect(found.map((f) => f.line)).toEqual([4]);
  });
});

describe('css files', () => {
  it('reads only block comments as comments', () => {
    expect(kinds('a { background: url(//x); color: #fff; }', true)).toEqual(['literal']);
    expect(kinds('a { background: white; }', true)).toEqual(['named-colour']);
    expect(kinds('/* #fff */ a { color: var(--ink); }', true)).toEqual([]);
  });
});

describe('withoutComments', () => {
  it('keeps strings, blanks comments and preserves lines', () => {
    expect(withoutComments("a('//') // x\n/* y\nz */ b")).toBe("a('//')     \n    \n     b");
  });
});

describe('tailwindPalettes', () => {
  it('reads the names of the shade-500 variables', () => {
    const names = tailwindPalettes(
      Array.from(
        { length: 10 },
        (_, i) => `--color-p${'abcdefghij'.charAt(i)}-500: oklch(0.5 0.1 20);`,
      ).join('\n'),
    );
    expect(names).toHaveLength(10);
    expect(() => tailwindPalettes('--color-red-500: x;')).toThrow(/too few/);
  });
});

describe('scope', () => {
  it.each([
    ['apps/web/src/app/header.tsx', true],
    ['apps/web/src/features/score/score.css', true],
    ['apps/web/src/index.css', false],
    ['apps/web/src/app/header.test.tsx', false],
    ['apps/web/src/test/contrast.ts', false],
    ['apps/web/e2e/player/open.spec.ts', false],
    ['packages/layout/src/glyphs.ts', false],
  ])('%s is in scope: %s', (path, expected) => {
    expect(inScope(path)).toBe(expected);
  });

  it('allows only listed files, and reports an entry that matches nothing', () => {
    expect(isAllowed(ALLOWED[0] ?? '')).toBe(true);
    expect(isAllowed('apps/web/src/app/header.tsx')).toBe(false);
    expect(staleEntries(['a.ts'], ['a.ts', 'gone.ts'])).toEqual(['gone.ts']);
  });
});

describe('the repository', () => {
  it('has no raw colour in a component file and no stale allowance', () => {
    const run = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(run.stdout).toMatch(/^No raw colours in \d+ web source files\./);
  });
});
