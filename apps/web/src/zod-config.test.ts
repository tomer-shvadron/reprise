import { describe, expect, it } from 'vitest';

const sources = import.meta.glob<string>(
  ['./main.tsx', './features/library/import/parse.worker.ts', './features/score/demo/main.tsx'],
  { query: '?raw', import: 'default', eager: true },
);

/** The first `import` statement of a module, comments skipped. */
const firstImport = (source: string): string | undefined => /^import\s[^;]*;/m.exec(source)?.[0];

describe('zod-config', () => {
  // Zod reads its jitless setting when a schema is created, so a module that builds one before
  // the config runs would probe `new Function` and trip the CSP.
  it('covers every entry point', () => {
    expect(Object.keys(sources)).toHaveLength(3);
  });

  it.each(Object.entries(sources))('is the first import of %s', (_path, source) => {
    expect(firstImport(source)).toMatch(/^import '@\/zod-config';$/);
  });
});
