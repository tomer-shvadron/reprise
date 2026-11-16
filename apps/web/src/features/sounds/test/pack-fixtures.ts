import { syntheticSfzPack } from '@reprise/audio/testing';

import type { PickedFile, PickedFolder, Platform } from '@/platform/platform';
import { createMemoryStorage, type MemoryStorage } from '@/test/memory-storage';
import { fakePlatform } from '@/test/services';

import type { IncomingFile } from '../install/install';
import type { PackManifest } from '../manifest';

import { zipBytes } from './zip-writer';

const encoder = new TextEncoder();

/** The synthetic pack's files by pack-relative path, copied so a test can change them. */
export function packContents(
  changes: Record<string, Uint8Array | string | null> = {},
): Map<string, Uint8Array> {
  const contents = new Map(syntheticSfzPack().contents);
  for (const [path, value] of Object.entries(changes)) {
    if (value === null) contents.delete(path);
    else contents.set(path, typeof value === 'string' ? encoder.encode(value) : value);
  }
  return contents;
}

export function incomingOf(contents: ReadonlyMap<string, Uint8Array>, prefix = ''): IncomingFile[] {
  return [...contents].map(([path, bytes]) => ({
    path: `${prefix}${path}`,
    size: bytes.length,
    read: () => Promise.resolve(bytes),
  }));
}

export function folderOf(name: string, contents: ReadonlyMap<string, Uint8Array>): PickedFolder {
  const files: PickedFile[] = [...contents].map(([path, bytes]) => ({
    name: path.slice(path.lastIndexOf('/') + 1),
    relativePath: path,
    size: bytes.length,
    read: (range) =>
      Promise.resolve(range ? bytes.slice(range.offset, range.offset + range.length) : bytes),
  }));
  return { name, files, truncated: false, skipped: 0 };
}

export async function zipOf(
  contents: ReadonlyMap<string, Uint8Array>,
  prefix = '',
  extra: { name: string; data: string }[] = [],
): Promise<Uint8Array> {
  return zipBytes([
    ...[...contents].map(([path, data]) => ({ name: `${prefix}${path}`, data })),
    ...extra,
  ]);
}

/** A picked zip: the whole file or a range of it, as the platform serves them. */
export function zipFileOf(name: string, bytes: Uint8Array) {
  return {
    name,
    size: bytes.length,
    read: (range: { offset: number; length: number }) =>
      Promise.resolve(bytes.slice(range.offset, range.offset + range.length)),
  };
}

/** A curated manifest for the synthetic pack: two instruments over `default.sfz` and `alt.sfz`. */
export function syntheticManifest(overrides: Partial<PackManifest> = {}): PackManifest {
  return {
    schema: 1,
    id: 'SynthPack001',
    name: 'Synthetic Pack',
    family: 'bass',
    gmPrograms: [33],
    format: 'sfz',
    version: '1',
    sourceUrl: 'https://example.com/pack',
    licenseName: 'CC0 1.0',
    licenseUrl: 'https://example.com/pack/license',
    directDownload: false,
    instruments: [
      { key: 'default', name: 'Default', entries: { default: 'default.sfz' } },
      { key: 'alt', name: 'Alt', entries: { default: 'alt.sfz' } },
    ],
    ...overrides,
  };
}

export interface TestPlatform {
  platform: Platform;
  storage: MemoryStorage;
}

export function testPlatform(overrides: Partial<Platform> = {}): TestPlatform {
  const storage = createMemoryStorage();
  return { storage, platform: fakePlatform({ ...storage.calls, ...overrides }) };
}

/** Paths a finished install leaves under `data/sounds`, work areas aside. */
export function packPaths(storage: MemoryStorage): string[] {
  return storage
    .paths()
    .filter((path) => path.startsWith('data/sounds/') && !path.startsWith('data/sounds/.'));
}
