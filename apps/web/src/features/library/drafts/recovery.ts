import { read } from '@reprise/formats';
import type { Id } from '@reprise/model';
import { create, type StoreApi, type UseBoundStore } from 'zustand';

import type { AppServices } from '@/app/services';
import { whenSaved } from '@/app/when-saved';
import type { Platform } from '@/platform/platform';

import type { SongsRepository } from '../db/repository';
import {
  DRAFTS_DIR,
  DraftSidecarSchema,
  draftFileKey,
  draftKeyOf,
  draftNativePath,
  draftSidecarPath,
} from './draft-paths';
import type { DraftKeeper } from './draft-keeper';

export interface DraftOffer {
  key: string;
  songId?: Id;
  /** What the document was called when the draft was written. */
  name: string;
  updatedAt: number;
}

export interface RecoveryState {
  offers: DraftOffer[];
  /** False after Later: the drafts stay on disk for the next launch. */
  open: boolean;
}

type DraftFiles = Pick<Platform, 'listDir' | 'readFile' | 'remove'>;

async function removeDraft(platform: Pick<Platform, 'remove'>, key: string): Promise<void> {
  await Promise.allSettled([
    platform.remove(draftNativePath(key)),
    platform.remove(draftSidecarPath(key)),
  ]);
}

/**
 * The drafts worth offering. A draft of a library song is offered only when it is newer than the
 * song's last save (or its import); one whose song is gone or already saved past it is removed,
 * as is a file with no partner or a sidecar that does not parse. Newest first.
 */
export async function findDraftOffers(
  platform: DraftFiles,
  repo: Pick<SongsRepository, 'get'>,
): Promise<DraftOffer[]> {
  const entries = await platform.listDir(DRAFTS_DIR);
  const halves = new Map<string, { native: boolean; sidecar: boolean }>();
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    const parsed = draftFileKey(entry.name);
    if (!parsed) {
      console.warn(`Ignored an unknown file in the drafts folder: ${entry.name}`);
      continue;
    }
    const half = halves.get(parsed.key) ?? { native: false, sidecar: false };
    half[parsed.kind] = true;
    halves.set(parsed.key, half);
  }
  const offers: DraftOffer[] = [];
  for (const [key, half] of halves) {
    if (!half.native || !half.sidecar) {
      console.warn(`Removed an unpaired draft: ${key}`);
      await removeDraft(platform, key);
      continue;
    }
    let sidecar;
    try {
      const text = new TextDecoder().decode(await platform.readFile(draftSidecarPath(key)));
      sidecar = DraftSidecarSchema.parse(JSON.parse(text));
    } catch (error) {
      console.warn(`Removed a draft with an unreadable sidecar: ${key}`, error);
      await removeDraft(platform, key);
      continue;
    }
    if (sidecar.key !== key) {
      console.warn(`Removed a draft whose sidecar names another key: ${key}`);
      await removeDraft(platform, key);
      continue;
    }
    if (sidecar.songId !== undefined) {
      const row = await repo.get(sidecar.songId);
      if (!row || key !== sidecar.songId || sidecar.updatedAt <= (row.savedAt ?? row.importedAt)) {
        await removeDraft(platform, key);
        continue;
      }
    } else if (!key.startsWith('doc-')) {
      console.warn(`Removed a draft with an unknown key: ${key}`);
      await removeDraft(platform, key);
      continue;
    }
    offers.push({
      key,
      ...(sidecar.songId !== undefined && { songId: sidecar.songId }),
      name: sidecar.name,
      updatedAt: sidecar.updatedAt,
    });
  }
  return offers.sort((a, b) => b.updatedAt - a.updatedAt);
}

export interface DraftRecoveryDeps {
  services: Pick<AppServices, 'document' | 'platform' | 'ui'>;
  repo: Pick<SongsRepository, 'get'>;
  /** Opens the song with these bytes as unsaved; the library's `openSong`. */
  openSong(id: Id, options: { bytes: Uint8Array; modified: true }): Promise<void>;
  keeper(): DraftKeeper | undefined;
  /** Whether the library loaded: with no rows to compare to nothing is judged, nothing removed. */
  ready(): boolean;
  notify(message: string): void;
}

export interface DraftRecovery {
  store: UseBoundStore<StoreApi<RecoveryState>>;
  /** Lists the drafts and opens the dialog when there is any to offer. */
  scan(): Promise<void>;
  recover(key: string): Promise<void>;
  discard(key: string): Promise<void>;
  discardAll(): Promise<void>;
  /** Closes the dialog and keeps the drafts. */
  later(): void;
}

export function createDraftRecovery(deps: DraftRecoveryDeps): DraftRecovery {
  const { services, repo } = deps;
  const { platform, document } = services;
  const store = create<RecoveryState>()(() => ({ offers: [], open: false }));

  const drop = (key: string) => {
    store.setState((state) => {
      const offers = state.offers.filter((offer) => offer.key !== key);
      return { offers, open: offers.length > 0 && state.open };
    });
  };

  const recoverNow = async (offer: DraftOffer) => {
    let bytes: Uint8Array;
    try {
      bytes = await platform.readFile(draftNativePath(offer.key));
    } catch {
      deps.notify(`The draft of “${offer.name}” could not be read, so it was removed.`);
      await removeDraft(platform, offer.key);
      drop(offer.key);
      return;
    }
    try {
      if (offer.songId !== undefined) {
        await deps.openSong(offer.songId, { bytes, modified: true });
        const state = document.getState();
        if (state.songId !== offer.songId || !state.dirty) {
          deps.notify(`“${offer.name}” could not be recovered.`);
          return;
        }
      } else {
        let score;
        try {
          ({ score } = await read(bytes, 'reprise'));
        } catch (error) {
          // The bytes are what they are: offering them again would fail the same way.
          deps.notify(
            `The draft of “${offer.name}” could not be read, so it was removed: ${error instanceof Error ? error.message : String(error)}`,
          );
          await removeDraft(platform, offer.key);
          drop(offer.key);
          return;
        }
        document.getState().newDocument(score, { modified: true });
        services.ui.getState().setScreen('player');
      }
    } catch (error) {
      deps.notify(
        `The draft of “${offer.name}” could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    // The recovered document is written under its own key at once; the old files go only after
    // that, so a second crash cannot lose it.
    await deps.keeper()?.flush();
    const state = document.getState();
    const current = state.id === undefined ? undefined : draftKeyOf(state.songId, state.id);
    if (offer.key !== current) await removeDraft(platform, offer.key);
    drop(offer.key);
  };

  return {
    store,
    async scan() {
      if (!deps.ready()) return;
      try {
        const offers = await findDraftOffers(platform, repo);
        store.setState({ offers, open: offers.length > 0 });
      } catch (error) {
        console.warn('Could not look for drafts to recover', error);
      }
    },
    recover(key) {
      const offer = store.getState().offers.find((candidate) => candidate.key === key);
      if (!offer) return Promise.resolve();
      return new Promise<void>((resolve) => {
        whenSaved(
          services,
          'recovering a draft',
          () => {
            void recoverNow(offer).finally(resolve);
          },
          resolve,
        );
      });
    },
    async discard(key) {
      await removeDraft(platform, key);
      drop(key);
    },
    async discardAll() {
      const { offers } = store.getState();
      await Promise.all(offers.map((offer) => removeDraft(platform, offer.key)));
      store.setState({ offers: [], open: false });
    },
    later() {
      store.setState({ open: false });
    },
  };
}
