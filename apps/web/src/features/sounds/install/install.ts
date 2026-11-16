import { checkPack, checkSfzFile } from '@reprise/audio';
import type { PackSnapshot, SfzFileCheck } from '@reprise/audio';

import type { PickedFile, PickedFolder, Platform } from '@/platform/platform';
import { parseStoragePath } from '@/platform/storage-path';

import {
  PACK_FILES_DIR,
  SOUNDS_DIR,
  packFolder,
  type InstalledPack,
  type PackInstrument,
  type PackManifest,
} from '../manifest';

import { normalizeZipPath, readZipDirectory, readZipEntry, ZIP_LIMITS, ZipError } from './zip';
import type { ZipSource } from './zip';

/** Work areas under `data/sounds/`: skipped by the scan, swept at startup. */
export const STAGING_DIR = `${SOUNDS_DIR}/.staging`;
export const TRASH_DIR = `${SOUNDS_DIR}/.trash`;
export const DOWNLOADS_DIR = `${SOUNDS_DIR}/.downloads`;

export const INSTALL_LIMITS = {
  /** Files copied into one pack. */
  maxFiles: 10_000,
  /** A text file (SFZ, include, notes): the loader reads it whole. */
  maxTextBytes: 4 * 1024 * 1024,
  /** A sample file: the SFZ loader's own cap. */
  maxSampleBytes: ZIP_LIMITS.maxEntryBytes,
  /** Bytes of a pack's files together. */
  maxTotalBytes: ZIP_LIMITS.maxTotalBytes,
  /** A curated pack may hold this many times its manifest's `sizeBytes`. */
  curatedMargin: 1.25,
  /** The first bytes of a sample kept for its header check. */
  headerBytes: 64 * 1024,
};

const TEXT_EXTENSIONS = new Set(['sfz', 'sfzh', 'inc', 'txt', 'md']);
const SAMPLE_EXTENSIONS = new Set(['wav', 'flac', 'ogg', 'oga', 'opus']);
/** The pack's own folder tree is the only thing copied: images, NKI and PDF files never are. */
const isLicenceOrReadme = (name: string) => /^(licen[cs]e|readme|copying)/i.test(name);

/** A refused install. `problems` are the details the screen lists under the message. */
export class InstallError extends Error {
  readonly problems: readonly string[];
  constructor(message: string, problems: readonly string[] = []) {
    super(message);
    this.name = 'InstallError';
    this.problems = problems;
  }
}

export interface IncomingFile {
  /** Relative to the archive or folder root, '/'-separated. */
  path: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export type InstallPhase = 'downloading' | 'extracting' | 'checking' | 'committing';

export interface InstallProgress {
  phase: InstallPhase;
  done: number;
  total?: number;
}

/** The files of a zip, listed from its central directory; nothing is inflated yet. */
export async function filesFromZip(
  source: ZipSource,
  signal?: AbortSignal,
): Promise<IncomingFile[]> {
  let directory;
  try {
    directory = await readZipDirectory(source);
  } catch (error) {
    throw asInstallError(error);
  }
  return directory.entries
    .filter((entry) => !entry.isDirectory)
    .map((entry) => ({
      path: entry.path,
      size: entry.size,
      read: () =>
        readZipEntry(source, directory, entry, signal ? { signal } : {}).catch((error: unknown) => {
          throw asInstallError(error);
        }),
    }));
}

export function filesFromFolder(folder: PickedFolder): IncomingFile[] {
  // A pack with files missing would play with holes, so a partial walk is refused outright.
  if (folder.truncated) {
    throw new InstallError(
      `${folder.name} holds too many files to read; pick the pack's own folder.`,
    );
  }
  if (folder.skipped > 0) {
    throw new InstallError(
      `${String(folder.skipped)} folders inside ${folder.name} could not be read.`,
    );
  }
  return folder.files.map((file: PickedFile) => ({
    path: file.relativePath,
    size: file.size,
    read: () => file.read(),
  }));
}

function asInstallError(error: unknown): unknown {
  return error instanceof ZipError
    ? new InstallError(`This archive was refused: ${error.message}`)
    : error;
}

export interface NormalizeOptions {
  /** The folder holding the pack inside the archive, when the manifest names one. */
  root?: string;
  /** The most the pack's files may total; the installer's cap otherwise. */
  maxTotalBytes?: number;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}

export const isTextFile = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return TEXT_EXTENSIONS.has(extensionOf(name)) || isLicenceOrReadme(name);
};

const isCopied = (path: string): boolean => {
  const name = path.slice(path.lastIndexOf('/') + 1);
  return isTextFile(path) || SAMPLE_EXTENSIONS.has(extensionOf(name)) || isLicenceOrReadme(name);
};

/**
 * Which files become the pack, and where. Skips dot entries, `__MACOSX` and anything outside the
 * copy list, strips the one top-level folder an archive usually has, and refuses what could not be
 * stored: a path the platform's storage rules refuse, a case-only collision, or a count or size
 * over the caps. Renaming a file would break the SFZ references, so it is never done silently.
 */
export function selectPackFiles(
  incoming: readonly IncomingFile[],
  options: NormalizeOptions = {},
): IncomingFile[] {
  const limit = options.maxTotalBytes ?? INSTALL_LIMITS.maxTotalBytes;
  const seen: IncomingFile[] = [];
  for (const file of incoming) {
    let path: string;
    try {
      path = normalizeZipPath(file.path);
    } catch (error) {
      throw asInstallError(error);
    }
    const segments = path.split('/');
    if (segments.some((segment) => segment.startsWith('.') || segment === '__MACOSX')) continue;
    seen.push({ ...file, path });
  }
  const stripped = stripRoot(seen, options.root);
  const kept = stripped.filter((file) => isCopied(file.path));
  if (kept.length === 0) throw new InstallError('No sound pack files were found in this source.');
  if (kept.length > INSTALL_LIMITS.maxFiles) {
    throw new InstallError(
      `This pack has ${String(kept.length)} files; at most ${String(INSTALL_LIMITS.maxFiles)} are installed.`,
    );
  }
  const folded = new Map<string, string>();
  let total = 0;
  for (const file of kept) {
    const cap = isTextFile(file.path) ? INSTALL_LIMITS.maxTextBytes : INSTALL_LIMITS.maxSampleBytes;
    if (file.size > cap) {
      throw new InstallError(
        `${file.path} is too large (${String(file.size)} bytes; at most ${String(cap)}).`,
      );
    }
    total += file.size;
    if (total > limit) {
      throw new InstallError('This pack holds more data than expected, so it was refused.');
    }
    try {
      // The staging path is the longest the file ever has.
      parseStoragePath(`${STAGING_DIR}/${'x'.repeat(21)}/${PACK_FILES_DIR}/${file.path}`);
    } catch (error) {
      throw new InstallError(
        `${file.path} cannot be stored on every platform (${error instanceof Error ? error.message : 'invalid name'}). It is not renamed, because the pack's own files refer to it by this name.`,
      );
    }
    const key = file.path.normalize('NFC').toLowerCase();
    const other = folded.get(key);
    if (other !== undefined) {
      throw new InstallError(
        `${file.path} and ${other} differ only in case, so they cannot both be stored.`,
      );
    }
    folded.set(key, file.path);
  }
  return kept.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function stripRoot(files: IncomingFile[], root: string | undefined): IncomingFile[] {
  if (root !== undefined) {
    const prefix = `${root.replace(/\/+$/, '')}/`;
    const inside = files.filter((file) => file.path.startsWith(prefix));
    if (inside.length > 0) {
      return inside.map((file) => ({ ...file, path: file.path.slice(prefix.length) }));
    }
  }
  const first = files[0]?.path.split('/')[0];
  const sole =
    first !== undefined &&
    files.every((file) => file.path.includes('/') && file.path.split('/')[0] === first);
  return sole ? files.map((file) => ({ ...file, path: file.path.slice(first.length + 1) })) : files;
}

function summarizeCheck(check: SfzFileCheck): string[] {
  const problems: string[] = [];
  const missing = check.missing.filter((entry) => !entry.includes('(case differs:'));
  if (missing.length > 0) {
    const shown = missing.slice(0, 3).join(', ');
    problems.push(
      `${check.path}: ${String(missing.length)} sample files are missing (${shown}${missing.length > 3 ? ', ...' : ''})`,
    );
  }
  for (const bad of check.badHeaders.slice(0, 3)) {
    problems.push(`${check.path}: ${bad.path} is not a usable sample (${bad.error})`);
  }
  for (const include of check.report.unresolvedIncludes) {
    problems.push(`${check.path}: the include ${include} is not in the pack`);
  }
  for (const escaped of check.report.escapedPaths) {
    problems.push(`${check.path}: ${escaped} points outside the pack`);
  }
  for (const limit of check.report.limits) problems.push(`${check.path}: ${limit}`);
  const invalid = Object.keys(check.report.invalid);
  if (invalid.length > 0)
    problems.push(`${check.path}: invalid opcodes: ${invalid.slice(0, 5).join(', ')}`);
  for (const error of check.errors) {
    if (/missing sample files$|unusable header$/.test(error)) continue;
    // The load lost data without a cause above: say so rather than pass it.
    if (error.startsWith('the load lost data') && problems.length > 0) continue;
    problems.push(`${check.path}: ${error}`);
  }
  return problems;
}

const passes = (check: SfzFileCheck) => summarizeCheck(check).length === 0;

const titleOf = (stem: string) =>
  stem
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());

/** Instruments of a custom pack: one per `.sfz` at the root that passes (any that passes if none is at the root). */
function customInstruments(checks: readonly SfzFileCheck[]): {
  instruments: PackInstrument[];
  problems: string[];
} {
  const atRoot = checks.filter((check) => !check.path.includes('/'));
  const candidates = atRoot.length > 0 ? atRoot : checks;
  const instruments: PackInstrument[] = [];
  const keys = new Set<string>();
  const problems: string[] = [];
  for (const check of candidates) {
    if (!passes(check)) {
      problems.push(...summarizeCheck(check));
      continue;
    }
    const file = check.path.slice(check.path.lastIndexOf('/') + 1).replace(/\.sfz$/i, '');
    const base =
      file
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'instrument';
    let key = base.slice(0, 60);
    for (let n = 2; keys.has(key); n += 1) key = `${base.slice(0, 56)}-${String(n)}`;
    keys.add(key);
    instruments.push({
      key,
      name: titleOf(file) || 'Instrument',
      entries: { default: check.path },
    });
  }
  return { instruments, problems };
}

/** A curated pack is checked by what the manifest promises: every entry present and playable. */
async function checkCurated(snapshot: PackSnapshot, manifest: PackManifest): Promise<string[]> {
  const paths = [
    ...new Set(manifest.instruments.flatMap((instrument) => Object.values(instrument.entries))),
  ];
  const missing = paths.filter((path) => !Object.hasOwn(snapshot, path));
  if (missing.length > 0) {
    throw new InstallError(
      `This is not the ${manifest.name} archive: ${missing.slice(0, 3).join(', ')} ${missing.length > 1 ? 'are' : 'is'} missing.`,
    );
  }
  const problems: string[] = [];
  for (const path of paths) problems.push(...summarizeCheck(await checkSfzFile(snapshot, path)));
  return problems;
}

export interface InstallOptions {
  platform: Platform;
  id: string;
  files: readonly IncomingFile[];
  /** A curated pack's manifest; a custom pack names itself with `name`. */
  manifest?: PackManifest;
  name?: string;
  source: InstalledPack['source'];
  signal?: AbortSignal;
  onProgress?: (progress: InstallProgress) => void;
  /**
   * Called when a pack with this id is already installed and is about to be swapped for the new
   * one; `reinstate` runs if the swap then fails and the old pack stays.
   */
  replace?: { release(): Promise<void>; reinstate(): Promise<void> };
  now?: () => Date;
}

const abortError = () => new DOMException('The install was cancelled', 'AbortError');

function stagingName(id: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return `${id}-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Stages the files under `data/sounds/.staging/`, checks them, writes `pack.json` and swaps the
 * folder into `data/sounds/<id>`. A refused or cancelled install leaves nothing under `data/sounds`
 * but swept work areas, and a failed update keeps the old pack.
 */
export async function installPack(options: InstallOptions): Promise<InstalledPack> {
  const { platform, id, manifest, signal, onProgress } = options;
  const margin = INSTALL_LIMITS.curatedMargin;
  const files = selectPackFiles(options.files, {
    ...(manifest?.download?.root !== undefined && { root: manifest.download.root }),
    ...(manifest?.sizeBytes !== undefined && {
      maxTotalBytes: Math.ceil(manifest.sizeBytes * margin),
    }),
  });
  const staging = `${STAGING_DIR}/${stagingName(id)}`;
  try {
    return await run();
  } catch (error) {
    await platform.remove(staging).catch(() => undefined);
    throw error;
  }

  async function run(): Promise<InstalledPack> {
    const total = files.reduce((sum, file) => sum + file.size, 0);
    const snapshot: Record<string, { size: number; bytes: Uint8Array; truncated?: boolean }> = {};
    const index: [string, number][] = [];
    let done = 0;
    onProgress?.({ phase: 'extracting', done, total });
    for (const file of files) {
      if (signal?.aborted) throw abortError();
      const bytes = await file.read();
      const text = isTextFile(file.path);
      if (bytes.length > (text ? INSTALL_LIMITS.maxTextBytes : INSTALL_LIMITS.maxSampleBytes)) {
        throw new InstallError(`${file.path} is larger than it declared, so the pack was refused.`);
      }
      await platform.writeFile(`${staging}/${PACK_FILES_DIR}/${file.path}`, bytes);
      index.push([file.path, bytes.length]);
      const kept = text ? bytes : bytes.slice(0, INSTALL_LIMITS.headerBytes);
      Object.defineProperty(snapshot, file.path, {
        value: {
          size: bytes.length,
          bytes: text ? bytes : kept,
          ...(!text && bytes.length > kept.length && { truncated: true }),
        },
        enumerable: true,
        configurable: true,
        writable: true,
      });
      done += bytes.length;
      onProgress?.({ phase: 'extracting', done, total });
    }
    if (signal?.aborted) throw abortError();
    onProgress?.({ phase: 'checking', done: 0 });
    let instruments: PackInstrument[];
    if (manifest) {
      const problems = await checkCurated(snapshot, manifest);
      if (problems.length > 0)
        throw new InstallError(`${manifest.name} did not pass the check.`, problems);
      instruments = manifest.instruments;
    } else {
      const checks = await checkPack(snapshot);
      const found = customInstruments(checks);
      if (found.instruments.length === 0) {
        throw new InstallError(
          checks.length === 0
            ? 'No .sfz file was found in this pack.'
            : 'No instrument in this pack passed the check.',
          found.problems,
        );
      }
      instruments = found.instruments;
    }
    if (signal?.aborted) throw abortError();
    const pack: InstalledPack = {
      ...(manifest ?? customManifest(id, options.name ?? 'Sound pack', instruments)),
      curated: manifest !== undefined,
      source: options.source,
      installedAt: (options.now?.() ?? new Date()).toISOString(),
      files: index,
    };
    onProgress?.({ phase: 'committing', done: 0 });
    await platform.writeFile(
      `${staging}/pack.json`,
      new TextEncoder().encode(JSON.stringify(pack, null, 2)),
    );
    await commit();
    return pack;
  }

  async function commit(): Promise<void> {
    const final = packFolder(id);
    const existing = (await platform.listDir(SOUNDS_DIR)).some((entry) => entry.name === id);
    if (!existing) {
      await platform.move(staging, final);
      return;
    }
    const trash = `${TRASH_DIR}/${stagingName(id)}`;
    await options.replace?.release();
    try {
      await platform.move(final, trash);
    } catch (error) {
      await options.replace?.reinstate();
      throw error;
    }
    try {
      await platform.move(staging, final);
    } catch (error) {
      // The old pack goes back; if even that fails the scan reports the damage.
      await platform.move(trash, final).catch(() => undefined);
      await options.replace?.reinstate();
      throw error;
    }
    await platform.remove(trash).catch(() => undefined);
  }
}

function customManifest(id: string, name: string, instruments: PackInstrument[]): PackManifest {
  return {
    schema: 1,
    id,
    name,
    family: 'other',
    gmPrograms: [],
    format: 'sfz',
    version: '1',
    directDownload: false,
    instruments,
  };
}

/** Removes leftovers of an install that never finished: staging, trash and downloads. */
export async function sweepWorkAreas(platform: Pick<Platform, 'remove'>): Promise<void> {
  await Promise.all(
    [STAGING_DIR, TRASH_DIR, DOWNLOADS_DIR].map((dir) =>
      platform.remove(dir).catch(() => undefined),
    ),
  );
}

export interface DownloadedZip {
  zip: ZipSource;
  cleanup(): Promise<void>;
}

/** Downloads a curated pack's archive through main, which checks the SHA-256 before the file is in place. */
export async function downloadPackArchive(options: {
  platform: Platform;
  manifest: PackManifest;
  onProgress?: (progress: InstallProgress) => void;
  signal?: AbortSignal;
}): Promise<DownloadedZip> {
  const { platform, manifest, onProgress, signal } = options;
  const { download } = manifest;
  if (!platform.download || !manifest.directDownload || !download) {
    throw new InstallError(`${manifest.name} cannot be downloaded here.`);
  }
  const to = `${DOWNLOADS_DIR}/${manifest.id}.zip`;
  const cleanup = () => platform.remove(to).catch(() => undefined);
  try {
    const { size } = await platform.download({
      url: download.url,
      to,
      sha256: download.sha256,
      maxBytes: Math.ceil(download.sizeBytes * 1.1),
      onProgress: (loaded, totalBytes) => {
        onProgress?.({
          phase: 'downloading',
          done: loaded,
          ...(totalBytes !== undefined && { total: totalBytes }),
        });
      },
      ...(signal && { signal }),
    });
    return {
      zip: { size, read: (offset, length) => platform.readFile(to, { offset, length }) },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export function zipSourceOfPicked(file: Pick<PickedFile, 'size' | 'read'>): ZipSource {
  return { size: file.size, read: (offset, length) => file.read({ offset, length }) };
}
