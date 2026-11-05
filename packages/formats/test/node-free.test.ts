import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PACKAGE = join(import.meta.dirname, '..');

/** Every production source file: tests and their builders may use Node, the reader may not. */
function productionSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'test' ? [] : productionSources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

describe('the package runs anywhere', () => {
  it('type-checks its source without Node types', () => {
    const config: unknown = JSON.parse(readFileSync(join(PACKAGE, 'tsconfig.json'), 'utf8'));
    expect(config).toMatchObject({ include: ['src'] });
    expect(JSON.stringify(config)).not.toContain('"node"');
  });

  it('imports no Node module and touches no Node global in its source', () => {
    const offenders = productionSources(join(PACKAGE, 'src')).filter((path) =>
      /from 'node:|\brequire\(|\bprocess\.|\bBuffer\b|\b__dirname\b/.test(
        readFileSync(path, 'utf8'),
      ),
    );
    expect(offenders).toEqual([]);
  });
});
