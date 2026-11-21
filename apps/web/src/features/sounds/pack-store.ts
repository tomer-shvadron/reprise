import { newId } from '@reprise/model';
import { createStore, type StoreApi } from 'zustand/vanilla';

import type { AudioService } from '@/app/audio/audio-service';
import type { PickedFolder, Platform } from '@/platform/platform';
import type { InstalledPackSource, PackDirectory } from '@/state/sound-packs';

import {
  downloadPackArchive,
  filesFromFolder,
  filesFromZip,
  InstallError,
  installPack,
  clearTrashOf,
  sweepWorkAreas,
  type IncomingFile,
  type InstallPhase,
  type InstallProgress,
} from './install/install';
import type { ZipSource } from './install/zip';
import {
  SOUNDS_DIR,
  packFolder,
  parseInstalledPack,
  type InstalledPack,
  type PackManifest,
} from './manifest';
import { reconcileCurated } from './curated-instruments';
import { sourceOfPack } from './pack-files';

/** A folder under `data/sounds` that is not a readable pack; the screen offers to remove it. */
export interface DamagedPack {
  folder: string;
  reason: string;
}

export interface InstallJob {
  /** The pack being installed: a curated id, or the new id of a custom pack. */
  packId: string;
  name: string;
  phase: InstallPhase;
  done: number;
  total: number | undefined;
}

export interface PackProblem {
  /** The pack it is about, for the screen's list. */
  name: string;
  message: string;
  problems: readonly string[];
}

export interface SoundPackState {
  /** What the audio service reads. */
  installed: readonly InstalledPackSource[];
  /** The same packs with their manifests, for the screen. */
  packs: readonly InstalledPack[];
  damaged: readonly DamagedPack[];
  job: InstallJob | undefined;
  /** The last failure by pack id (a custom install's own id, or a curated id), until dismissed. */
  problems: Readonly<Record<string, PackProblem>>;
  /** `scan` has finished once. */
  scanned: boolean;
  /**
   * The installed pack whose Remove confirmation is open and the one being renamed, kept here so a
   * row's context menu can start them (#337). The Sounds sheet clears both when it unmounts.
   */
  removingId: string | undefined;
  renamingId: string | undefined;
  /** A `data-focus` key a command asks the screen to focus once, after it removed a row. */
  focusAfter: string | undefined;
}

/** A zip the user picked or dropped. */
export interface ZipFile {
  name: string;
  size: number;
  read(range: { offset: number; length: number }): Promise<Uint8Array>;
}

export interface SoundPackStore extends PackDirectory {
  getState(): SoundPackState;
  /** The zustand store behind the state, for `useStore` in the screen. */
  readonly api: StoreApi<SoundPackState>;
  /** Replaces the installed set and tells the directory's subscribers. */
  setInstalled(installed: readonly InstalledPackSource[]): void;
  /** Fires after the installed set changed, not on install progress. */
  subscribe(listener: () => void): () => void;
  /** Reads `data/sounds`: sweeps work areas, lists packs and damaged folders. */
  scan(): Promise<void>;
  /** Downloads a curated pack (desktop) and installs it; also the update of an installed one. */
  installCurated(manifest: PackManifest): Promise<boolean>;
  /** A zip: the curated `manifest`'s pack, or a custom pack when none is given. */
  installZip(zip: ZipFile, manifest?: PackManifest): Promise<boolean>;
  /** A picked folder, as `installZip`. */
  installFolder(folder: PickedFolder, manifest?: PackManifest): Promise<boolean>;
  /** Stops the running install; it cleans up after itself. */
  cancel: () => void;
  /** Releases the pack from the engine, removes its folder, and reinstates it if that fails. */
  remove(id: string): Promise<boolean>;
  /** Removes a damaged folder. */
  removeDamaged(folder: string): Promise<boolean>;
  rename(id: string, name: string): Promise<boolean>;
  dismissProblem: (id: string) => void;
}

export interface SoundPackStoreOptions {
  platform: Platform;
  /** The audio service, read lazily: it is created after the store, with the store as its directory. */
  audio?: () => Pick<AudioService, 'releasePack' | 'reinstatePack'> | undefined;
  now?: () => Date;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/**
 * The installed sound packs and the `PackDirectory` the audio service reads, with the actions the
 * Sounds screen runs: scan, install (download, zip, folder), remove, rename. One install runs at
 * a time. Installing a pack never edits a song; removing one only takes its sound away (the
 * tracks play General MIDI), see ADR-0028.
 */
export function createSoundPackStore(options: SoundPackStoreOptions): SoundPackStore {
  const { platform } = options;
  const store = createStore<SoundPackState>(() => ({
    installed: [],
    packs: [],
    damaged: [],
    job: undefined,
    problems: {},
    scanned: false,
    removingId: undefined,
    renamingId: undefined,
    focusAfter: undefined,
  }));
  /** A source object per installed pack version: reinstalling is what makes a new one. */
  const sources = new Map<
    string,
    { installedAt: string; name: string; source: InstalledPackSource }
  >();
  let controller: AbortController | undefined;
  /** Installs that finished, so a scan can tell one landed while it was reading. */
  let installs = 0;

  const sourceFor = (pack: InstalledPack): InstalledPackSource => {
    const known = sources.get(pack.id);
    if (known?.installedAt === pack.installedAt) {
      if (known.name === pack.name) return known.source;
      const renamed = { ...known.source, name: pack.name };
      sources.set(pack.id, { installedAt: pack.installedAt, name: pack.name, source: renamed });
      return renamed;
    }
    const source = sourceOfPack(platform, pack);
    sources.set(pack.id, { installedAt: pack.installedAt, name: pack.name, source });
    return source;
  };

  const setPacks = (packs: readonly InstalledPack[]) => {
    const sorted = [...packs].sort((a, b) => a.name.localeCompare(b.name));
    const installed = sorted.map(sourceFor);
    const previous = store.getState().installed;
    // The same sources in the same order is not a change: the audio service would reload for it.
    const same =
      installed.length === previous.length &&
      installed.every((source, i) => source === previous[i]);
    store.setState({ packs: sorted, installed: same ? previous : installed });
  };

  const problem = (id: string, value: PackProblem | undefined) => {
    const rest = Object.fromEntries(
      Object.entries(store.getState().problems).filter(([key]) => key !== id),
    );
    store.setState({ problems: value ? { ...rest, [id]: value } : rest });
  };

  const audio = () => options.audio?.();
  const nameOf = (id: string) => store.getState().packs.find((pack) => pack.id === id)?.name ?? id;

  async function scan(): Promise<void> {
    if (!store.getState().job) await sweepWorkAreas(platform);
    const installsAtStart = installs;
    const packs: InstalledPack[] = [];
    const damaged: DamagedPack[] = [];
    const entries = await platform.listDir(SOUNDS_DIR).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.kind !== 'directory') continue;
      try {
        const bytes = await platform.readFile(`${packFolder(entry.name)}/pack.json`);
        const pack = parseInstalledPack(new TextDecoder().decode(bytes));
        if (!pack)
          damaged.push({ folder: entry.name, reason: 'pack.json is not a sound pack description' });
        else if (pack.id !== entry.name)
          damaged.push({
            folder: entry.name,
            reason: 'The folder name does not match the pack id',
          });
        else packs.push(pack);
      } catch (error) {
        damaged.push({
          folder: entry.name,
          reason: `pack.json cannot be read (${messageOf(error)})`,
        });
      }
    }
    // An install that finished while the folders were being read wrote a pack the listing may
    // predate: keep it (or its newer version) rather than drop it until the next scan.
    if (installs !== installsAtStart) {
      for (const current of store.getState().packs) {
        const listed = packs.findIndex((pack) => pack.id === current.id);
        const found = packs[listed];
        if (listed < 0) packs.push(current);
        else if (found && found.installedAt < current.installedAt) packs[listed] = current;
      }
    }
    const dropped: Record<string, PackProblem> = {};
    const reconciled = packs.map((pack) => {
      const result = reconcileCurated(pack);
      if (result.dropped.length > 0)
        dropped[pack.id] = {
          name: pack.name,
          message:
            'Some articulation files of this pack are missing, so those sounds are left out. Remove the pack and download it again to restore them.',
          problems: result.dropped,
        };
      return result.pack;
    });
    setPacks(reconciled);
    for (const [id, value] of Object.entries(dropped)) problem(id, value);
    store.setState({ damaged, scanned: true });
  }

  async function run(
    job: { packId: string; name: string; phase?: InstallPhase },
    work: (context: {
      signal: AbortSignal;
      onProgress: (progress: InstallProgress) => void;
      replace: { release(): Promise<void>; reinstate(): Promise<void> };
    }) => Promise<InstalledPack>,
  ): Promise<boolean> {
    if (store.getState().job) {
      problem(job.packId, {
        name: job.name,
        message: 'Another pack is being installed. Wait for it or cancel it first.',
        problems: [],
      });
      return false;
    }
    const mine = new AbortController();
    controller = mine;
    problem(job.packId, undefined);
    store.setState({
      job: { ...job, phase: job.phase ?? 'extracting', done: 0, total: undefined },
    });
    const onProgress = (progress: InstallProgress) => {
      store.setState({
        job: { ...job, phase: progress.phase, done: progress.done, total: progress.total },
      });
    };
    try {
      const pack = await work({
        signal: mine.signal,
        onProgress,
        replace: {
          release: async () => {
            await audio()?.releasePack(job.packId);
          },
          reinstate: async () => {
            await audio()?.reinstatePack(job.packId);
          },
        },
      });
      installs += 1;
      setPacks([...store.getState().packs.filter((other) => other.id !== pack.id), pack]);
      return true;
    } catch (error) {
      if (!isAbort(error)) {
        problem(job.packId, {
          name: job.name,
          message:
            error instanceof InstallError
              ? error.message
              : `The install failed: ${messageOf(error)}`,
          problems: error instanceof InstallError ? error.problems : [],
        });
      }
      return false;
    } finally {
      controller = undefined;
      store.setState({ job: undefined });
    }
  }

  const installFiles = (
    id: string,
    files: readonly IncomingFile[],
    context: Parameters<Parameters<typeof run>[1]>[0],
    extra: { manifest?: PackManifest; name?: string; source: InstalledPack['source'] },
  ) =>
    installPack({
      platform,
      id,
      files,
      ...extra,
      signal: context.signal,
      onProgress: context.onProgress,
      replace: context.replace,
      ...(options.now && { now: options.now }),
    });

  const customName = (name: string) =>
    name
      .replace(/\.zip$/i, '')
      .trim()
      .slice(0, 120) || 'Sound pack';

  return {
    api: store,
    getState: store.getState,
    get: (id) => store.getState().installed.find((pack) => pack.id === id),
    setInstalled: (installed) => {
      store.setState({ installed });
    },
    subscribe: (listener) =>
      store.subscribe((state, previous) => {
        if (state.installed !== previous.installed) listener();
      }),
    scan,

    installCurated: (manifest) =>
      run({ packId: manifest.id, name: manifest.name, phase: 'downloading' }, async (context) => {
        const archive = await downloadPackArchive({
          platform,
          manifest,
          onProgress: context.onProgress,
          signal: context.signal,
        });
        try {
          const files = await filesFromZip(archive.zip, context.signal);
          return await installFiles(manifest.id, files, context, { manifest, source: 'download' });
        } finally {
          await archive.cleanup();
        }
      }),

    installZip: (zip, manifest) => {
      const id = manifest?.id ?? newId();
      return run({ packId: id, name: manifest?.name ?? customName(zip.name) }, async (context) => {
        const source: ZipSource = {
          size: zip.size,
          read: (offset, length) => zip.read({ offset, length }),
        };
        const files = await filesFromZip(source, context.signal);
        return installFiles(id, files, context, {
          ...(manifest && { manifest }),
          name: customName(zip.name),
          source: 'zip',
        });
      });
    },

    installFolder: (folder, manifest) => {
      const id = manifest?.id ?? newId();
      return run({ packId: id, name: manifest?.name ?? folder.name }, (context) =>
        installFiles(id, filesFromFolder(folder), context, {
          ...(manifest && { manifest }),
          name: folder.name.trim().slice(0, 120) || 'Sound pack',
          source: 'folder',
        }),
      );
    },

    cancel: () => {
      controller?.abort();
    },

    remove: async (id) => {
      const state = store.getState();
      if (state.job?.packId === id) return false;
      const service = audio();
      await service?.releasePack(id);
      try {
        await platform.remove(packFolder(id));
      } catch (error) {
        await service?.reinstatePack(id);
        problem(id, {
          name: nameOf(id),
          message: `The pack could not be removed: ${messageOf(error)}`,
          problems: [],
        });
        return false;
      }
      await clearTrashOf(platform, id);
      sources.delete(id);
      setPacks(store.getState().packs.filter((pack) => pack.id !== id));
      return true;
    },

    removeDamaged: async (folder) => {
      try {
        await platform.remove(packFolder(folder));
      } catch (error) {
        problem(folder, {
          name: folder,
          message: `The folder could not be removed: ${messageOf(error)}`,
          problems: [],
        });
        return false;
      }
      store.setState({
        damaged: store.getState().damaged.filter((entry) => entry.folder !== folder),
      });
      return true;
    },

    rename: async (id, name) => {
      const pack = store.getState().packs.find((candidate) => candidate.id === id);
      const trimmed = name.trim();
      // As `remove`: an update running now would be given the old manifest, index and date.
      if (!pack || store.getState().job?.packId === id || trimmed === '' || trimmed.length > 120) {
        return false;
      }
      const renamed = { ...pack, name: trimmed };
      try {
        await platform.writeFile(
          `${packFolder(id)}/pack.json`,
          new TextEncoder().encode(JSON.stringify(renamed, null, 2)),
        );
      } catch (error) {
        problem(id, {
          name: nameOf(id),
          message: `The pack could not be renamed: ${messageOf(error)}`,
          problems: [],
        });
        return false;
      }
      setPacks(
        store.getState().packs.map((candidate) => (candidate.id === id ? renamed : candidate)),
      );
      return true;
    },

    dismissProblem: (id) => {
      problem(id, undefined);
    },
  };
}
