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
  it('gives Growlybass its staccato file on dirty and clean only', () => {
    const { pack, dropped } = reconcileCurated(installedGrowlybass());
    expect(dropped).toEqual([]);
    const sets = Object.fromEntries(pack.instruments.map((i) => [i.key, i.entries['staccato']]));
    expect(sets).toEqual({
      dirty: 'growlybass_vicious.sfz',
      clean: 'growlybass_vicious.sfz',
      vicious: undefined,
      angry: undefined,
      excessive: undefined,
      shifty: undefined,
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

describe('reconcileCurated with noise keys', () => {
  const emily = () => {
    const listed = curatedPack('qxmLveBRBWt8');
    if (!listed) throw new Error('Emilyguitar is not in the curated list');
    return listed;
  };
  const installed = (skip: string[] = []): InstalledPack => {
    const listed = emily();
    const names = new Set(
      listed.instruments.flatMap((i) => Object.values(i.entries).map((v) => v.split('#')[0] ?? v)),
    );
    return {
      ...listed,
      instruments: listed.instruments.map((i) => ({
        ...i,
        entries: { default: i.entries['default'] ?? '' },
      })),
      curated: true,
      source: 'download' as const,
      installedAt: '2026-11-01T00:00:00.000Z',
      files: [...names].filter((n) => !skip.includes(n)).map((n): [string, number] => [n, 10]),
    };
  };

  it('keeps the noise keys on the dead entry, and checks the file before them', () => {
    const { pack, dropped } = reconcileCurated(installed());
    expect(dropped).toEqual([]);
    const dead = Object.fromEntries(pack.instruments.map((i) => [i.key, i.entries['dead']]));
    expect(dead['basic']).toBe('emily_basic.sfz#key:91-95');
    expect(dead['five-voices']).toBe('emily_basic.sfz#key:91-95');
  });

  it('drops only the dead set when its file is missing', () => {
    const { pack, dropped } = reconcileCurated(installed(['emily_basic.sfz']));
    expect(dropped).toContain('Five voices: dead');
    expect(pack.instruments.find((i) => i.key === 'five-voices')?.entries).toEqual({
      default: 'emily_five_voice.sfz',
    });
  });
});
