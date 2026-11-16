import { curatedPack } from './curated-packs';
import type { InstalledPack, PackInstrument } from './manifest';

export interface Reconciled {
  pack: InstalledPack;
  /** Articulation files the list names that the installed copy lacks, as "<instrument>: <set>". */
  dropped: string[];
}

const fold = (path: string) => path.normalize('NFC').toLowerCase();

/**
 * An installed curated pack stores the manifest of its install, so entries the list gained later
 * (the Growlybass staccato file) never reach it. The files are the same while the version is, so
 * the instruments are taken from the list instead of forcing a re-download for a metadata change.
 * A listed file the copy does not hold drops that set, or the instrument when it is the default;
 * the pack stays. A copy of another version, or a custom pack, is left as it is.
 */
export function reconcileCurated(pack: InstalledPack): Reconciled {
  const listed = pack.curated ? curatedPack(pack.id) : undefined;
  if (listed?.version !== pack.version) return { pack, dropped: [] };
  const present = new Set(pack.files.map(([path]) => fold(path)));
  const dropped: string[] = [];
  const instruments: PackInstrument[] = [];
  for (const instrument of listed.instruments) {
    const entries: Record<string, string> = {};
    for (const [set, path] of Object.entries(instrument.entries)) {
      if (present.has(fold(path))) entries[set] = path;
      else dropped.push(`${instrument.name}: ${set}`);
    }
    if (Object.hasOwn(entries, 'default')) instruments.push({ ...instrument, entries });
  }
  // A pack that lost every instrument keeps what it stored: the listing is a refinement only.
  return instruments.length === 0
    ? { pack, dropped: [] }
    : { pack: { ...pack, instruments }, dropped };
}
