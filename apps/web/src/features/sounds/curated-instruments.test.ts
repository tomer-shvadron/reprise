import { describe, expect, it } from 'vitest';

import { reconcileCurated } from './curated-instruments';
import { curatedPack } from './curated-packs';
import type { InstalledPack } from './manifest';

const growlybass = () => {
  const listed = curatedPack('oP2Y6UriacYx');
  if (!listed) throw new Error('Growlybass is not in the curated list');
  return listed;
};

/** What the first install stored: the manifest of its day (default files only) and a file index. */
function installedGrowlybass(
  overrides: Partial<InstalledPack> = {},
  skip: string[] = [],
): InstalledPack {
  const listed = growlybass();
  // A stand-in with the archive's file names and no sample bytes: only the index is read.
  const names = new Set(listed.instruments.flatMap((i) => Object.values(i.entries)));
  const files = [...names]
    .filter((name) => !skip.includes(name))
    .map((name): [string, number] => [name, 10]);
  const stored = listed.instruments.map((instrument) => ({
    ...instrument,
    entries: { default: instrument.entries['default'] ?? '' },
  }));
  return {
    ...listed,
    instruments: stored,
    curated: true,
    source: 'download' as const,
    installedAt: '2026-11-01T00:00:00.000Z',
    files,
    ...overrides,
  };
}

describe('reconcileCurated', () => {
  it('gives Growlybass its staccato file on every sound but vicious, which is staccato already', () => {
    const { pack, dropped } = reconcileCurated(installedGrowlybass());
    expect(dropped).toEqual([]);
    const sets = Object.fromEntries(pack.instruments.map((i) => [i.key, i.entries['staccato']]));
    expect(sets).toEqual({
      dirty: 'growlybass_vicious.sfz',
      clean: 'growlybass_vicious.sfz',
      vicious: undefined,
      angry: 'growlybass_vicious.sfz',
      excessive: 'growlybass_vicious.sfz',
      shifty: 'growlybass_vicious.sfz',
    });
  });

  it('drops only the set whose file the copy lacks, and keeps the pack', () => {
    const { pack, dropped } = reconcileCurated(installedGrowlybass({}, ['growlybass_vicious.sfz']));
    // The vicious instrument's own default is the missing file, so it goes; the others lose staccato.
    expect(pack.instruments.map((i) => i.key)).toEqual([
      'dirty',
      'clean',
      'angry',
      'excessive',
      'shifty',
    ]);
    expect(pack.instruments.every((i) => !Object.hasOwn(i.entries, 'staccato'))).toBe(true);
    expect(dropped).toContain('Dirty: staccato');
  });

  it('leaves another version, and a custom pack, as they were stored', () => {
    const older = installedGrowlybass({ version: '1.001' });
    expect(reconcileCurated(older).pack).toBe(older);
    const custom = installedGrowlybass({ curated: false });
    expect(reconcileCurated(custom).pack).toBe(custom);
  });
});
