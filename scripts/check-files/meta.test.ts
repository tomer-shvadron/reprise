import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ROOT_DIR } from './files.ts';
import { emptyRecord, isCheckRecord } from './meta.ts';

const COPIES = [
  'packages/formats/test/files-check/check-meta.ts',
  'packages/layout/test/check-meta.ts',
  'packages/audio/src/test/check-meta.ts',
];

describe('the check record', () => {
  it.each(COPIES)('%s is a byte-identical copy of meta.ts', (copy) => {
    const original = readFileSync(join(ROOT_DIR, 'scripts/check-files/meta.ts'), 'utf8');
    expect(readFileSync(join(ROOT_DIR, copy), 'utf8')).toBe(original);
  });

  it('is recognised by its guard', () => {
    expect(isCheckRecord(emptyRecord('fixtures/a.gp5', 'read'))).toBe(true);
    expect(isCheckRecord({ ...emptyRecord('fixtures/a.gp5', 'read'), check: 'other' })).toBe(false);
    expect(isCheckRecord(undefined)).toBe(false);
  });
});
