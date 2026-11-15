import { parseSfz } from './parse';
import { dirname, resolvePath } from './paths';
import { preprocess } from './preprocess';
import type { SfzReader } from './preprocess';
import { emptyReport } from './report';
import type { SfzReport } from './report';
import { resolveSfz } from './resolve';
import type { SfzLayer } from './resolve';
import type { Region } from '../sampler/region-map';

export interface SfzLoadOptions {
  packId: string;
  layer?: string;
}

export interface SfzParsed {
  regions: Region[];
  layers: SfzLayer[];
  keyswitchRange?: { lo: number; hi: number };
  report: SfzReport;
}

/**
 * Reads one SFZ file, and what it includes, through `read` and maps it onto `Region`s. `read`
 * takes pack-relative '/' paths; it is how the pack stays untrusted data, since nothing else here
 * touches a file. Only an unreadable root file throws (`SfzParseError`).
 */
export async function loadSfz(
  path: string,
  read: SfzReader,
  options: SfzLoadOptions,
): Promise<SfzParsed> {
  const report = emptyReport();
  const text = await preprocess(path, read, report);
  const root = resolvePath('', path) ?? path;
  const resolved = resolveSfz(
    parseSfz(text, report),
    { ...options, baseDir: dirname(root) },
    report,
  );
  return { ...resolved, report };
}
