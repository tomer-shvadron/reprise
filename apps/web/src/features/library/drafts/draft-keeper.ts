import type { Id } from '@reprise/model';

import { documentNameOf } from '@/app/window-title';
import type { AppServices } from '@/app/services';
import type { Platform } from '@/platform/platform';
import { withViewNotation, type DocumentState } from '@/state/document';

import type { Parser } from '../import/parser';
import { draftKeyOf, draftNativePath, draftSidecarPath, type DraftSidecar } from './draft-paths';

/** A draft is written this long after the last edit... */
export const DRAFT_DEBOUNCE_MS = 1000;
/** ...and at least this often while edits keep coming. */
export const DRAFT_MAX_WAIT_MS = 10_000;

export interface DraftKeeper {
  /**
   * Writes a pending draft now (starting it synchronously, for `pagehide`) and resolves once
   * everything queued has landed.
   */
  flush(): Promise<void>;
  /** Removes the open document's draft and stops it being written until the next edit. */
  discard(): Promise<void>;
  stop(): Promise<void>;
}

export interface DraftKeeperDeps {
  services: Pick<AppServices, 'document'>;
  platform: Pick<Platform, 'writeFile' | 'remove'>;
  /** Serializes in a worker (or inline where there is none); only `native` is used. */
  parser: Pick<Parser, 'native' | 'dispose'>;
  now?: () => number;
  debounceMs?: number;
  maxWaitMs?: number;
  /** Runs `task` when the main thread is idle; tests run it at once. */
  idle?: (task: () => void) => void;
}

function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 2000 });
  else setTimeout(task, 0);
}

/**
 * Keeps the open document's unsaved changes on disk, so a crash or a kill loses at most the last
 * second. It writes while the document is modified (debounced, with a maximum wait during
 * continuous editing) and removes the draft when the document becomes clean, is replaced or is
 * closed. The key is the song id, else `doc-<document id>`; a first Save that mints a song id
 * makes the document clean, which removes the earlier key too. Writes and removals run one at a
 * time in order, so a removal never overtakes the write it follows.
 */
export function startDraftKeeper(deps: DraftKeeperDeps): DraftKeeper {
  const { services, platform, parser } = deps;
  const now = deps.now ?? Date.now;
  const debounceMs = deps.debounceMs ?? DRAFT_DEBOUNCE_MS;
  const maxWaitMs = deps.maxWaitMs ?? DRAFT_MAX_WAIT_MS;
  const idle = deps.idle ?? whenIdle;
  const { document } = services;
  // The DOM document, which the store named `document` shadows.
  const document_ = globalThis.document;

  let queue: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    queue = queue.then(task).catch((error: unknown) => {
      console.warn('Could not keep the draft', error);
    });
    return queue;
  };

  // What the keeper has seen of the open document.
  let documentId: Id | undefined;
  let score: DocumentState['score'];
  let notation: DocumentState['view']['notation'] | undefined;
  let dirty = false;
  // Keys written for this document: all removed when it becomes clean or goes.
  let written = new Set<string>();
  // Bumped whenever a write in progress stops being wanted.
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let since: number | undefined;
  let stopped = false;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    since = undefined;
  };

  const removeKeys = (keys: Iterable<string>): Promise<void> => {
    const list = [...keys];
    if (list.length === 0) return queue;
    return enqueue(async () => {
      await Promise.all(
        list.flatMap((key) => [
          platform.remove(draftNativePath(key)),
          platform.remove(draftSidecarPath(key)),
        ]),
      );
    });
  };

  const write = (): Promise<void> => {
    clearTimer();
    const state = document.getState();
    if (!state.dirty || !state.score || state.id === undefined) return queue;
    const { id, songId } = state;
    const mine = ++generation;
    const key = draftKeyOf(songId, id);
    const source = withViewNotation(state.score, state.view.notation);
    const name = documentNameOf(state);
    const title = state.score.meta.title;
    return enqueue(async () => {
      // Stale by the time the queue reaches it: the document went, or became clean.
      if (mine !== generation) return;
      await new Promise<void>((resolve) => {
        idle(resolve);
      });
      if (mine !== generation) return;
      const outcome = await parser.native(source);
      if (mine !== generation) return;
      if (!outcome.ok) {
        console.warn(`Could not serialize the draft: ${outcome.message}`);
        return;
      }
      const sidecar: DraftSidecar = {
        version: 1,
        key,
        ...(songId !== undefined && { songId }),
        name,
        title,
        updatedAt: now(),
      };
      // The bytes first: a sidecar without bytes is an unpaired file recovery clears, bytes
      // without a sidecar are not offered.
      await platform.writeFile(draftNativePath(key), outcome.native);
      written.add(key);
      await platform.writeFile(
        draftSidecarPath(key),
        new TextEncoder().encode(JSON.stringify(sidecar)),
      );
      // Another key was written before (a song id arrived while the edits stayed unsaved).
      const stale = [...written].filter((other) => other !== key);
      for (const other of stale) written.delete(other);
      if (stale.length > 0) {
        await Promise.all(
          stale.flatMap((other) => [
            platform.remove(draftNativePath(other)),
            platform.remove(draftSidecarPath(other)),
          ]),
        );
      }
    });
  };

  const schedule = (immediately: boolean) => {
    const at = now();
    since ??= at;
    if (timer !== undefined) clearTimeout(timer);
    const wait = immediately ? 0 : Math.min(debounceMs, Math.max(0, since + maxWaitMs - at));
    timer = setTimeout(() => void write(), wait);
  };

  const drop = (): Promise<void> => {
    clearTimer();
    generation += 1;
    const keys = written;
    written = new Set();
    return removeKeys(keys);
  };

  const onState = (state: DocumentState) => {
    if (stopped) return;
    if (state.id !== documentId) {
      // Replaced or closed: by then the user saved or chose Don't save (the guards ask first).
      void drop();
      documentId = state.id;
      score = state.score;
      notation = state.view.notation;
      dirty = state.dirty;
      // A document that opens modified is a recovered draft: written at once.
      if (dirty) schedule(true);
      return;
    }
    if (!state.dirty) {
      if (dirty) {
        dirty = false;
        void drop();
      }
      score = state.score;
      notation = state.view.notation;
      return;
    }
    const changed = state.score !== score || state.view.notation !== notation || !dirty;
    dirty = true;
    score = state.score;
    notation = state.view.notation;
    if (changed) schedule(false);
  };

  const unsubscribe = document.subscribe(onState);
  onState(document.getState());

  const flush = (): Promise<void> => {
    if (timer !== undefined) void write();
    return queue;
  };
  const onHide = () => void flush();
  const onVisibility = () => {
    if (document_.visibilityState === 'hidden') void flush();
  };
  addEventListener('pagehide', onHide);
  document_.addEventListener('visibilitychange', onVisibility);

  return {
    flush,
    discard() {
      // Not dirty-tracking: the user said Don't save, so even edits that follow before the
      // window goes are not wanted. The next edit starts a draft again.
      dirty = false;
      return drop();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      removeEventListener('pagehide', onHide);
      document_.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
      await queue;
      parser.dispose();
    },
  };
}
