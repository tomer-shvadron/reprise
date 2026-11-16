import type { SfzFiles } from '@reprise/audio';

import type { Platform } from '@/platform/platform';
import type { InstalledPackSource } from '@/state/sound-packs';

import { packFilePath, type InstalledPack } from './manifest';

/**
 * The reader the audio engine gets for one installed pack. A path is looked up in the pack's own
 * file index, exactly first and then ignoring case (a pack written on a case-insensitive file
 * system refers to `Samples/A.wav` for `samples/a.wav`), so a path outside the index never reaches
 * the platform: nothing a `.sfz` names can read another folder.
 */
export function createPackFiles(
  platform: Pick<Platform, 'readFile'>,
  pack: InstalledPack,
): SfzFiles {
  const sizes = new Map<string, number>(pack.files);
  const folded = new Map<string, string>();
  for (const [path] of pack.files) folded.set(path.toLowerCase(), path);
  const resolve = (path: string): string | undefined =>
    sizes.has(path) ? path : folded.get(path.toLowerCase());
  return {
    read(path) {
      const resolved = resolve(path);
      if (resolved === undefined)
        return Promise.reject(new Error(`No file ${path} in ${pack.name}`));
      return platform.readFile(packFilePath(pack.id, resolved));
    },
    size(path) {
      const resolved = resolve(path);
      return resolved === undefined ? undefined : sizes.get(resolved);
    },
  };
}

export function sourceOfPack(
  platform: Pick<Platform, 'readFile'>,
  pack: InstalledPack,
): InstalledPackSource {
  return {
    id: pack.id,
    name: pack.name,
    files: createPackFiles(platform, pack),
    instruments: pack.instruments.map(({ key, name, entries }) => ({ key, name, entries })),
  };
}
