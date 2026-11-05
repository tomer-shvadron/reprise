import { readFileSync, readdirSync } from 'node:fs';
import { relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  FEATURES,
  FIXTURES_DIR,
  FORMATS,
  MANIFEST_PATH,
  NON_FIXTURE_FILES,
  type Manifest,
} from './corpus.ts';

function isManifest(value: unknown): value is Manifest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fixtures' in value &&
    Array.isArray(value.fixtures) &&
    'features' in value &&
    Array.isArray(value.features)
  );
}

function loadManifest(): Manifest {
  const parsed: unknown = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!isManifest(parsed)) throw new Error('fixtures/manifest.json is not a manifest');
  return parsed;
}

function filesOnDisk(): string[] {
  return readdirSync(FIXTURES_DIR, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(FIXTURES_DIR, `${entry.parentPath}/${entry.name}`))
    .filter((path) => !NON_FIXTURE_FILES.has(path))
    .sort();
}

const manifest = loadManifest();

describe('fixture manifest', () => {
  it('lists exactly the files in fixtures/', () => {
    const listed = manifest.fixtures.map((fixture) => fixture.path).sort();
    expect(listed).toEqual(filesOnDisk());
  });

  it('files every fixture under its own format', () => {
    for (const fixture of manifest.fixtures) {
      expect(FORMATS).toContain(fixture.format);
      expect(fixture.path).toBe(`${fixture.format}/${fixture.path.split('/').at(-1) ?? ''}`);
      expect(fixture.path.endsWith(`.${fixture.format}`)).toBe(true);
    }
  });

  it.each(FORMATS)('has at least two %s fixtures', (format) => {
    const count = manifest.fixtures.filter((fixture) => fixture.format === format).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('declares the feature list the describe script detects', () => {
    expect(manifest.features).toEqual([...FEATURES]);
  });

  it.each(FEATURES)('exercises %s in at least one fixture', (feature) => {
    expect(manifest.fixtures.some((fixture) => fixture.features.includes(feature))).toBe(true);
  });

  it('records alphaTab counts for every fixture', () => {
    for (const fixture of manifest.fixtures) {
      expect(fixture.tracks).toBeGreaterThan(0);
      expect(fixture.bars).toBeGreaterThan(0);
      expect(fixture.notes).toBeGreaterThanOrEqual(0);
    }
  });
});
