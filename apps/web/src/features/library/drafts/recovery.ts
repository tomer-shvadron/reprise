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
 * as is a sidecar without bytes. Bytes whose sidecar is missing or unreadable are offered as an
 * untitled recovery, never removed. Newest first.
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
    if (!half.native) {
      // A sidecar with no bytes holds nothing to recover.
      await removeDraft(platform, key);
      continue;
    }
    // Bytes that cannot be judged (no sidecar yet: a crash between the two writes; one this
    // version cannot read) may be the only copy of an edit, so they are offered as an untitled
    // recovery and never removed unasked.
    const unjudged = (why: string): DraftOffer => {
      console.warn(`Offering a draft that cannot be judged (${why}): ${key}`);
      return { key, name: 'Unsaved changes (details lost)', updatedAt: 0 };
    };
    let sidecar;
    if (half.sidecar) {
      try {
        const text = new TextDecoder().decode(await platform.readFile(draftSidecarPath(key)));
        sidecar = DraftSidecarSchema.parse(JSON.parse(text));
      } catch {
        sidecar = undefined;
      }
    }
    if (!sidecar || sidecar.key !== key) {
      offers.push(unjudged(half.sidecar ? 'unreadable sidecar' : 'no sidecar'));
      continue;
    }
    if (sidecar.songId !== undefined) {
      const row = await repo.get(sidecar.songId);
      if (!row) {
        // Its song is gone: nothing to put the changes back on.
        await removeDraft(platform, key);
        continue;
      }
      if (key !== sidecar.songId) {
        offers.push(unjudged('a sidecar that names another song'));
        continue;
      }
      if (sidecar.updatedAt <= (row.savedAt ?? row.importedAt)) {
        await removeDraft(platform, key);
        continue;
      }
    } else if (!key.startsWith('doc-')) {
      offers.push(unjudged('an unknown key'));
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
  /** Whether a draft under this key is still waiting for an answer: the keeper never overwrites it. */
  isDeferred(key: string): boolean;
  /**
   * Opens the dialog again when this song has a draft waiting, so Recover or Discard comes
   * before an edit. Call it after the song opens.
   */
  reoffer(songId: Id): void;
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

  // While a recovery runs the offer is not "waiting": the recovered document writes under the same
  // key (a song's), which the keeper otherwise refuses to overwrite.
  const withdrawn = async (offer: DraftOffer, run: () => Promise<boolean>) => {
    const before = store.getState();
    drop(offer.key);
    const done = await run();
    if (!done && !store.getState().offers.some((candidate) => candidate.key === offer.key)) {
      store.setState((state) => ({
        offers: [...state.offers, offer].sort((a, b) => b.updatedAt - a.updatedAt),
        open: before.open || state.open,
      }));
    }
  };

  /** True when the draft is dealt with (recovered, or removed as unreadable). */
  const recoverNow = async (offer: DraftOffer): Promise<boolean> => {
    let bytes: Uint8Array;
    try {
      bytes = await platform.readFile(draftNativePath(offer.key));
    } catch {
      deps.notify(`The draft of “${offer.name}” could not be read, so it was removed.`);
      await removeDraft(platform, offer.key);
      return true;
    }
    try {
      if (offer.songId !== undefined) {
        await deps.openSong(offer.songId, { bytes, modified: true });
        const state = document.getState();
        if (state.songId !== offer.songId || !state.dirty) {
          deps.notify(`“${offer.name}” could not be recovered.`);
          return false;
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
          return true;
        }
        document.getState().newDocument(score, { modified: true });
        services.ui.getState().setScreen('player');
      }
    } catch (error) {
      deps.notify(
        `The draft of “${offer.name}” could not be opened: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    // The recovered document is written under its own key at once; the old files go only once
    // that is confirmed on disk, so a second crash cannot lose it.
    const state = document.getState();
    const current = state.id === undefined ? undefined : draftKeyOf(state.songId, state.id);
    const confirmed = (await deps.keeper()?.flush()) === true;
    if (offer.key === current) return true;
    if (!confirmed) {
      deps.notify(
        `“${offer.name}” is open again, but its draft could not be rewritten, so the old one was kept.`,
      );
      return true;
    }
    await removeDraft(platform, offer.key);
    return true;
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
            void withdrawn(offer, () => recoverNow(offer)).finally(resolve);
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
    isDeferred: (key) => store.getState().offers.some((offer) => offer.key === key),
    reoffer(songId) {
      if (store.getState().offers.some((offer) => offer.songId === songId)) {
        store.setState({ open: true });
      }
    },
  };
}
