/**
 * The scripts `package.json` runs with plain `node` cannot import a workspace package by value:
 * the packages export TypeScript source with extensionless relative imports, which Node does not
 * resolve (#307, where `pnpm desktop:smoke` crashed with ERR_MODULE_NOT_FOUND). A script that
 * needs package code runs under Vitest instead, like `check:files` and the global setups. This
 * walks each node-run entry point's relative import graph and fails on a value import of `@reprise/*`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const NODE_SCRIPT = /(?:^|&&\s*)node\s+(\S+\.ts)\b/;

function entryPoints(): string[] {
  const manifest: unknown = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const scripts =
    typeof manifest === 'object' && manifest !== null && 'scripts' in manifest
      ? manifest.scripts
      : undefined;
  if (typeof scripts !== 'object' || scripts === null)
    throw new Error('package.json has no scripts');
  return Object.values(scripts).flatMap((command) => {
    const match = typeof command === 'string' ? NODE_SCRIPT.exec(command) : null;
    return match?.[1] === undefined ? [] : [resolve(ROOT, match[1])];
  });
}

/** Import and export-from statements; `import type` and `export type` are erased by Node. */
const STATEMENT = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm;
const BARE = /^\s*import\s+['"]([^'"]+)['"]/gm;

function specifiers(source: string): string[] {
  const found = [...source.matchAll(STATEMENT), ...source.matchAll(BARE)];
  return found.flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}

function offenders(entry: string): string[] {
  const seen = new Set<string>();
  const bad: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const specifier of specifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('@reprise/')) bad.push(`${file} imports ${specifier}`);
      else if (specifier.startsWith('.') && specifier.endsWith('.ts')) {
        visit(resolve(dirname(file), specifier));
      }
    }
  };
  visit(entry);
  return bad;
}

describe('node-run scripts', () => {
  it('finds the entry points', () => {
    expect(entryPoints().length).toBeGreaterThan(5);
  });

  it('ignores type-only imports', () => {
    expect(specifiers(`import type { A } from '@reprise/x';\nimport { b } from './b.ts';`)).toEqual(
      ['./b.ts'],
    );
    expect(specifiers(`import { read } from '@reprise/formats';`)).toEqual(['@reprise/formats']);
  });

  it.each(entryPoints().map((entry) => [entry.slice(ROOT.length + 1), entry] as const))(
    '%s imports no workspace package by value',
    (_name, entry) => {
      expect(offenders(entry)).toEqual([]);
    },
  );
});
