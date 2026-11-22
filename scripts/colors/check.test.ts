import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALLOWED, findRawColors, inScope, isAllowed, staleEntries } from './check.ts';

const CLI = fileURLToPath(new URL('check.ts', import.meta.url));
const kinds = (source: string) => findRawColors(source).map((finding) => finding.kind);

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
