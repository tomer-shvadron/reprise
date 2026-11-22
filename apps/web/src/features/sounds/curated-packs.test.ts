import { describe, expect, it } from 'vitest';

// eslint-disable-next-line import-x/no-relative-packages -- a doc file, not code: the root package exports nothing to import it through
import doc from '../../../../../docs/reference/sound-packs.md?raw';

import { splitEntry } from '@reprise/audio';

import { CURATED_PACKS, curatedPack, updateAvailable } from './curated-packs';
import { PackManifestSchema } from './manifest';

describe('the curated list', () => {
  it.each(CURATED_PACKS.map((pack) => [pack.name, pack] as const))(
    '%s passes the schema',
    (_name, pack) => {
      expect(PackManifestSchema.safeParse(pack).success).toBe(true);
    },
  );

  it('has unique 12-character alphanumeric ids and unique names', () => {
    const ids = CURATED_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9A-Za-z]{12}$/);
    expect(new Set(CURATED_PACKS.map((pack) => pack.name)).size).toBe(CURATED_PACKS.length);
  });

  it('records the source and licence of every pack, over https', () => {
    for (const pack of CURATED_PACKS) {
      expect(pack.sourceUrl).toMatch(/^https:\/\//);
      expect(pack.licenseUrl).toMatch(/^https:\/\//);
      expect(pack.licenseName).toBeTruthy();
    }
  });

  it('pins a hash and size for every direct download, and no other pack carries a download', () => {
    for (const pack of CURATED_PACKS) {
      if (pack.directDownload) {
        expect(pack.download?.sha256).toMatch(/^[0-9a-f]{64}$/);
        expect(pack.download?.sizeBytes).toBeGreaterThan(0);
        expect(pack.download?.url).toMatch(/^https:\/\//);
        expect(pack.sizeBytes).toBeGreaterThan(0);
      } else {
        expect(pack.download).toBeUndefined();
      }
    }
  });

  it('only direct-downloads packs under an open licence', () => {
    for (const pack of CURATED_PACKS.filter((candidate) => candidate.directDownload)) {
      expect(pack.licenseName).toMatch(/^(CC0|CC BY|MIT|Apache|BSD|GPL)/);
    }
  });

  it('has a default entry for every instrument, with unique keys per pack', () => {
    for (const pack of CURATED_PACKS) {
      const keys = pack.instruments.map((instrument) => instrument.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const instrument of pack.instruments)
        expect(instrument.entries['default']).toMatch(/\.sfz$/);
    }
  });

  it('reads every entry as a file, and puts noise keys only on the dead set', () => {
    for (const pack of CURATED_PACKS) {
      for (const instrument of pack.instruments) {
        for (const [set, value] of Object.entries(instrument.entries)) {
          const split = splitEntry(value);
          expect(split, `${pack.name} ${instrument.key} ${set}`).toBeDefined();
          if (split?.keys) expect(set).toBe('dead');
        }
      }
    }
  });

  it('is described in docs/reference/sound-packs.md, pack by pack', () => {
    for (const pack of CURATED_PACKS) {
      expect(doc, pack.name).toContain(pack.name);
      expect(doc, pack.name).toContain(pack.download?.sha256 ?? pack.name);
    }
  });

  it('finds a pack by id and flags an older installed version', () => {
    const [first] = CURATED_PACKS;
    if (!first) throw new Error('empty list');
    expect(curatedPack(first.id)).toBe(first);
    expect(curatedPack('nope')).toBeUndefined();
    expect(updateAvailable({ id: first.id, version: first.version })).toBe(false);
    expect(updateAvailable({ id: first.id, version: '0.1' })).toBe(true);
    expect(updateAvailable({ id: 'custom000001', version: '1' })).toBe(false);
  });
});
