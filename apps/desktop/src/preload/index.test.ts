import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// app.enableSandbox() leaves the preload only `electron` (and a few polyfilled modules); a Node
// import added later would fail at runtime in the packaged app, so this fails on it first.
const source = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

/** Every `import ... from 'x'` and `export ... from 'x'`, with whether it is type-only. */
function importsOf(text: string): { specifier: string; typeOnly: boolean }[] {
  const found: { specifier: string; typeOnly: boolean }[] = [];
  for (const match of text.matchAll(
    /^(?:import|export)\s+(type\s+)?([^;]*?)\s+from\s+'([^']+)'/gms,
  )) {
    found.push({ specifier: match[3] ?? '', typeOnly: match[1] !== undefined });
  }
  for (const match of text.matchAll(/(?:\bimport|\brequire)\(\s*'([^']+)'\s*\)/g)) {
    found.push({ specifier: match[1] ?? '', typeOnly: false });
  }
  for (const match of text.matchAll(/^import\s+'([^']+)'/gm)) {
    found.push({ specifier: match[1] ?? '', typeOnly: false });
  }
  return found;
}

describe('the preload script', () => {
  it('imports only electron at runtime, and only types from @reprise/web', () => {
    const imports = importsOf(source);
    expect(imports.length).toBeGreaterThan(0);
    for (const { specifier, typeOnly } of imports) {
      if (specifier === '@reprise/web')
        expect(typeOnly, '@reprise/web must be import type').toBe(true);
      else expect(specifier).toBe('electron');
    }
  });
});
