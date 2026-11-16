import type { Id } from '@reprise/model';

import { documentNameOf } from '@/app/window-title';
import type { AppServices } from '@/app/services';
import type { Platform } from '@/platform/platform';
import { withViewNotation, type DocumentState } from '@/state/document';

import type { NativeOutcome } from '../import/parse-import';
import type { Parser } from '../import/parser';
import { draftKeyOf, draftNativePath, draftSidecarPath, type DraftSidecar } from './draft-paths';

/** A draft is written this long after the last edit... */
export const DRAFT_DEBOUNCE_MS = 1000;
/** ...and at least this often while edits keep coming. */
export const DRAFT_MAX_WAIT_MS = 10_000;
/** A worker that has not answered by now is taken for hung and replaced. */
export const DRAFT_SERIALIZE_TIMEOUT_MS = 60_000;

export interface DraftKeeper {
  /**
   * Starts a pending draft write now, skipping the idle wait (so a `pagehide` starts it as early
   * as it can), and resolves once everything queued has landed. True when the open document's
   * draft is on disk, false when it is not (a failed write, nothing to write).
   */
  flush(): Promise<boolean>;
  /**
   * Removes the open document's draft, in-flight write included, and writes nothing more until the
   * next edit.
   */
  discard(): Promise<void>;
  stop(): Promise<void>;
}

export interface DraftKeeperDeps {
  services: Pick<AppServices, 'document'>;
  platform: Pick<Platform, 'writeFile' | 'remove'>;
  /** Makes the parser that serializes (a worker, or inline where there is none). */
  createParser: () => Pick<Parser, 'native' | 'dispose'>;
  /** Tells the user, without blocking, that drafts are not being kept. */
  notify?: (message: string) => void;
  /** Whether a draft under this key is waiting for the user's answer: it is never overwritten, edits go under the document's own key. */
  deferred?: (key: string) => boolean;
  now?: () => number;
  debounceMs?: number;
  maxWaitMs?: number;
  serializeTimeoutMs?: number;
  /** Runs `task` when the main thread is idle; tests run it at once. */
  idle?: (task: () => void) => void;
}

function whenIdle(task: () => void): void {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(task, { timeout: 2000 });
  else setTimeout(task, 0);
}

class WorkerStalled extends Error {}

/**
 * Keeps the open document's unsaved changes on disk, so a crash or a kill loses at most the last
 * second or so. It writes while the document is modified (debounced, with a maximum wait during
 * continuous editing, and again when a save ends with the document still modified) and removes
 * the draft when the document becomes clean, is replaced or is closed. The key is the song id,
 * else `doc-<document id>`; a first Save that mints a song id makes the document clean, which
 * removes the earlier key too.
 *
 * A write records its key before any bytes go out, so a removal that comes while it is in flight
 * deletes what it writes. Serialization is not queued: a hung worker never delays a removal, and
 * it is replaced once (then autosave says so). The file writes and removals run one at a time, in
 * order.
 */
export function startDraftKeeper(deps: DraftKeeperDeps): DraftKeeper {
  const { services, platform } = deps;
  const now = deps.now ?? Date.now;
  const debounceMs = deps.debounceMs ?? DRAFT_DEBOUNCE_MS;
  const maxWaitMs = deps.maxWaitMs ?? DRAFT_MAX_WAIT_MS;
  const timeoutMs = deps.serializeTimeoutMs ?? DRAFT_SERIALIZE_TIMEOUT_MS;
  const idle = deps.idle ?? whenIdle;
  const { document } = services;
  // The DOM document, which the store named `document` shadows.
  const document_ = globalThis.document;

  let parser = deps.createParser();
  let queue: Promise<void> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>, fallback: T): Promise<T> => {
    const run = queue.then(task).catch((error: unknown) => {
      console.warn('Could not keep the draft', error);
      return fallback;
    });
    queue = run.then(() => undefined);
    return run;
  };

  // What the keeper has seen of the open document.
  let documentId: Id | undefined;
  let score: DocumentState['score'];
  let notation: DocumentState['view']['notation'] | undefined;
  let dirty = false;
  let saving = false;
  // Keys a write has been started for, so a removal covers a write still in flight; and the
  // ones whose bytes and sidecar are on disk.
  let written = new Set<string>();
  let confirmed = new Set<string>();
  // Bumped whenever a write in progress stops being wanted.
  let generation = 0;
  let inflight: Promise<boolean> = Promise.resolve(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let since: number | undefined;
  let stopped = false;
  let reported = false;

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    since = undefined;
  };

  const removeFiles = (keys: readonly string[]): Promise<void> =>
    Promise.all(
      keys.flatMap((key) => [
        platform.remove(draftNativePath(key)),
        platform.remove(draftSidecarPath(key)),
      ]),
    ).then(() => undefined);

  const removeKeys = (keys: Iterable<string>): Promise<void> => {
    const list = [...keys];
    if (list.length === 0) return queue;
    return enqueue(() => removeFiles(list), undefined);
  };

  const timeout = <T>(work: Promise<T>): Promise<T> => {
    let timer_: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      timer_ = setTimeout(() => {
        reject(new WorkerStalled('The serializer did not answer'));
      }, timeoutMs);
    });
    return Promise.race([work, stalled]).finally(() => {
      clearTimeout(timer_);
    });
  };

  // One restart of a worker that failed or hung, then the failure is reported.
  const serialize = async (
    source: NonNullable<DocumentState['score']>,
    wanted: () => boolean,
  ): Promise<NativeOutcome> => {
    let last: NativeOutcome = { ok: false, code: 'worker-failed', message: 'not started' };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const used = parser;
      try {
        last = await timeout(used.native(source));
        // A score that cannot be written fails the same way again: no new worker for it.
        if (last.ok || last.code !== 'worker-failed') return last;
      } catch (error) {
        last = {
          ok: false,
          code: 'worker-failed',
          message: error instanceof Error ? error.message : String(error),
        };
      }
      // A write that stopped being wanted neither retries nor reports.
      if (stopped || !wanted()) return last;
      // Only the worker that failed is replaced: another write may have replaced it already, and
      // disposing that one would fail its calls too.
      if (parser === used) {
        used.dispose();
        parser = deps.createParser();
      }
    }
    return last;
  };

  const report = (message: string) => {
    console.warn(`Could not serialize the draft: ${message}`);
    if (reported) return;
    reported = true;
    deps.notify?.(`Autosave is off: ${message}`);
  };

  const write = (urgent = false): Promise<boolean> => {
    clearTimer();
    const state = document.getState();
    if (!state.dirty || !state.score || state.id === undefined) return Promise.resolve(false);
    const { id, songId } = state;
    // The draft already under the song's key is waiting for the user's answer, so it is not
    // overwritten: edits go under the document's own key, and recovery offers both.
    const songKey = draftKeyOf(songId, id);
    const key = deps.deferred?.(songKey) === true ? `doc-${id}` : songKey;
    const mine = ++generation;
    // Before any bytes go out: a removal that comes while this is writing then deletes them.
    written.add(key);
    const keys = written;
    const source = withViewNotation(state.score, state.view.notation);
    // When the content was captured, not when it lands: a draft is judged newer than a save by
    // the content it holds.
    const capturedAt = now();
    const name = documentNameOf(state);
    const { title } = state.score.meta;
    const run = (async (): Promise<boolean> => {
      // A pagehide cannot wait for idle time.
      if (!urgent) {
        await new Promise<void>((resolve) => {
          idle(resolve);
        });
      }
      if (mine !== generation) return false;
      const outcome = await serialize(source, () => mine === generation);
      if (mine !== generation) return false;
      if (!outcome.ok) {
        report(outcome.message);
        return false;
      }
      return enqueue(async () => {
        if (mine !== generation) return false;
        const sidecar: DraftSidecar = {
          version: 1,
          key,
          // Only a draft under the song's own key names the song; the other is an untitled copy.
          ...(songId !== undefined && key === songKey && { songId }),
          name,
          title,
          updatedAt: capturedAt,
        };
        // The bytes first: bytes without a sidecar are offered as an untitled recovery, a
        // sidecar without bytes is removed.
        await platform.writeFile(draftNativePath(key), outcome.native);
        // Superseded or removed while the bytes were going out: a removal queued behind this
        // deletes them (the key is recorded), a newer write replaces them.
        if (mine !== generation) return false;
        await platform.writeFile(
          draftSidecarPath(key),
          new TextEncoder().encode(JSON.stringify(sidecar)),
        );
        if (mine !== generation) return false;
        confirmed.add(key);
        reported = false;
        // Another key was written before (a song id arrived while the edits stayed unsaved).
        const stale = [...keys].filter((other) => other !== key);
        for (const other of stale) {
          keys.delete(other);
          confirmed.delete(other);
        }
        if (stale.length > 0) await removeFiles(stale);
        return true;
      }, false);
    })();
    inflight = run;
    return run;
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
    confirmed = new Set();
    return removeKeys(keys);
  };

  const onState = (state: DocumentState) => {
    if (stopped) return;
    const saveEnded = saving && !state.saving;
    saving = state.saving;
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
    const changed =
      state.score !== score || state.view.notation !== notation || !dirty || saveEnded;
    dirty = true;
    score = state.score;
    notation = state.view.notation;
    // A save that ends with the document still modified (an edit landed while it ran): the draft
    // from before may predate what the save wrote, so a fresh one follows.
    if (changed) schedule(false);
  };

  const unsubscribe = document.subscribe(onState);
  onState(document.getState());

  const flush = async (): Promise<boolean> => {
    if (timer !== undefined) void write(true);
    await inflight.catch(() => false);
    await queue;
    const state = document.getState();
    return state.id !== undefined && confirmed.has(draftKeyOf(state.songId, state.id));
  };
  // Best effort: the page may be gone before the write lands, so the last second can be lost.
  const onHide = () => void flush();
  const onVisibility = () => {
    if (document_.visibilityState === 'hidden') void flush();
  };
  addEventListener('pagehide', onHide);
  document_.addEventListener('visibilitychange', onVisibility);

  return {
    flush,
    discard() {
      // The document stays as the keeper saw it, so only a real edit starts a draft again.
      return drop();
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      unsubscribe();
      removeEventListener('pagehide', onHide);
      document_.removeEventListener('visibilitychange', onVisibility);
      clearTimer();
      await inflight.catch(() => false);
      await queue;
      parser.dispose();
    },
  };
}
