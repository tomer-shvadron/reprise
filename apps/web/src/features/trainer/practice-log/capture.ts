import { newId, type Id, type Score } from '@reprise/model';

import type { AppServices } from '@/app/services';
import { selectRunning } from '@/state/playback';

import {
  accrued,
  CHECKPOINT_MS,
  IDLE_MS,
  isIdle,
  isStorable,
  TEMPO_SETTLE_MS,
  WRITE_DEBOUNCE_MS,
} from './accrual';
import type { PracticeRepository } from './repository';
import { toRow, type PracticeSessionRow } from './row';

export type CaptureServices = Pick<AppServices, 'document' | 'playback' | 'practice'>;

export interface CaptureOptions {
  /** Epoch milliseconds, for the `startedAt` and `endedAt` stamps; replaced in tests. */
  now?: () => number;
  /** Monotonic milliseconds, for durations; replaced in tests. */
  monotonic?: () => number;
}

export interface PracticeCapture {
  /** Adds up the time played so far and writes the session now; keeps watching. */
  flush(): Promise<void>;
  /** Ends and stores the session, then stops watching. Safe to call twice. */
  stop(): Promise<void>;
}

/**
 * Keeps the practice session of the open document, over the existing `practice` store. A session
 * starts on a document's first play and counts only time spent `playing` (the count-in, the
 * standalone metronome and the tuner never count: only a song's transport is watched). It ends on
 * a document switch or after `IDLE_MS` without playing.
 *
 * Nothing runs on the position tick: the playback subscription compares `transport`, the loop and
 * the tempo by reference and returns. Played time is added up at play and pause changes and at
 * `CHECKPOINT_MS` while playing. Writes are debounced, and `pagehide` or a hidden window flushes
 * at once.
 */
export function startPracticeCapture(
  services: CaptureServices,
  repo: PracticeRepository,
  options: CaptureOptions = {},
): PracticeCapture {
  const { document, playback, practice } = services;
  // The DOM document, which the store named `document` shadows.
  const document_ = globalThis.document;
  const now = options.now ?? Date.now;
  // Durations and the idle gap come from the monotonic clock, so setting the system clock does not
  // stretch or merge sessions. Chromium's monotonic clock stands still while a Mac sleeps, so the
  // idle gap is the larger of the two readings and an overnight sleep still ends the session.
  const mono = options.monotonic ?? (() => performance.now());

  let rowId: Id | undefined;
  let playingSince: number | undefined;
  let lastActiveAt = 0;
  let lastActiveMono = 0;
  // The score of the open document, kept so a session that outlives its document still labels
  // its loops from the score they were played on.
  let score: Score | undefined = document.getState().score;
  let stopped = false;
  let checkpoint: ReturnType<typeof setInterval> | undefined;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let tempoTimer: ReturnType<typeof setTimeout> | undefined;
  let writeTimer: ReturnType<typeof setTimeout> | undefined;
  let writing: Promise<void> = Promise.resolve();

  const store = () => practice.getState();

  const put = (row: PracticeSessionRow) => {
    // Always started at once, never queued behind a write in flight: a flush from `pagehide` must
    // reach IndexedDB before the page goes, and IndexedDB runs transactions on a store in the
    // order they were created, so the order of the rows is kept.
    writing = repo.put(row).catch((error: unknown) => {
      console.warn('Could not keep the practice session', error);
    });
  };

  const write = () => {
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    writeTimer = undefined;
    const session = store().session;
    if (!session || !rowId || session.songId === undefined || !isStorable(session)) return;
    put(toRow(session, { id: rowId, songId: session.songId, endedAt: lastActiveAt, score }));
  };

  const schedule = () => {
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    writeTimer = setTimeout(write, WRITE_DEBOUNCE_MS);
  };

  /** Adds the time played since the last accrual to the session. */
  const accrue = () => {
    if (playingSince === undefined) return;
    const at = mono();
    store().addPlayed(accrued(playingSince, at));
    playingSince = at;
    lastActiveAt = now();
    lastActiveMono = at;
  };

  /** Stamps the sample with the time played so far, which `accrue` first brings up to date. */
  const recordTempoNow = () => {
    accrue();
    store().recordTempo(playback.getState().settings.tempo);
  };

  /** A tempo that has held is recorded; a pending one is committed when the transport changes. */
  const commitTempo = () => {
    if (tempoTimer === undefined) return;
    clearTimeout(tempoTimer);
    tempoTimer = undefined;
    recordTempoNow();
  };

  const clearTimers = () => {
    clearInterval(checkpoint);
    clearTimeout(idle);
    clearTimeout(tempoTimer);
    checkpoint = undefined;
    idle = undefined;
    tempoTimer = undefined;
  };

  /** Ends the session and writes it at once. */
  const end = () => {
    accrue();
    commitTempo();
    clearTimers();
    playingSince = undefined;
    // `end` clears the store, so write from the session it returns.
    const session = store().end();
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    writeTimer = undefined;
    const id = rowId;
    rowId = undefined;
    if (!session || !id || session.songId === undefined || !isStorable(session)) return;
    put(toRow(session, { id, songId: session.songId, endedAt: lastActiveAt, score }));
  };

  const begin = () => {
    const { id, songId } = document.getState();
    if (id === undefined) return;
    const at = now();
    // A session of another document would be replaced and returned, but `end` stored ours first.
    store().start({ songId, documentId: id, now: at });
    if (store().session?.documentId !== id) return;
    rowId = newId();
    lastActiveAt = at;
    lastActiveMono = mono();
    const { settings } = playback.getState();
    store().recordTempo(settings.tempo);
  };

  const idleFor = () => Math.max(mono() - lastActiveMono, now() - lastActiveAt);

  const armIdle = () => {
    clearTimeout(idle);
    idle = setTimeout(
      () => {
        if (playback.getState().transport === 'playing') return;
        if (isIdle(idleFor())) end();
        else armIdle();
      },
      Math.max(IDLE_MS - idleFor(), 0),
    );
  };

  const onTransport = (previous: string, next: string) => {
    const running = selectRunning(playback.getState());
    const wasPlaying = previous === 'playing';
    const isPlaying = next === 'playing';

    if (running) {
      // A timer that was throttled or missed changes nothing: the check runs here too.
      if (store().session && isIdle(idleFor())) end();
      if (!store().session) begin();
    }
    // The loop is noted every time the transport starts, so one set while paused counts, and it
    // moves to the end of the list, where Resume reads it. The speed trainer's Start notes its own
    // loop before any session exists, which this covers too.
    const { loop } = playback.getState().settings;
    if (running && loop && store().session) store().noteLoop(loop);
    if (!wasPlaying && isPlaying && store().session) {
      commitTempo();
      playingSince = mono();
      clearTimeout(idle);
      idle = undefined;
      clearInterval(checkpoint);
      checkpoint = setInterval(accrue, CHECKPOINT_MS);
    } else if (wasPlaying && !isPlaying) {
      accrue();
      commitTempo();
      playingSince = undefined;
      clearInterval(checkpoint);
      checkpoint = undefined;
      if (store().session) {
        lastActiveAt = now();
        lastActiveMono = mono();
        armIdle();
      }
    }
  };

  const unsubscribePlayback = playback.subscribe((state, previous) => {
    if (stopped) return;
    if (state.transport !== previous.transport) onTransport(previous.transport, state.transport);
    const { loop, tempo } = state.settings;
    if (loop !== previous.settings.loop && loop && selectRunning(state)) store().noteLoop(loop);
    if (tempo !== previous.settings.tempo && store().session) {
      clearTimeout(tempoTimer);
      tempoTimer = setTimeout(() => {
        tempoTimer = undefined;
        recordTempoNow();
      }, TEMPO_SETTLE_MS);
    }
  });

  const unsubscribeDocument = document.subscribe((state, previous) => {
    if (stopped) return;
    if (state.id !== previous.id) {
      // The old document's score labels the loops of the session being stored.
      score = previous.score;
      if (store().session) end();
      score = state.score;
      return;
    }
    score = state.score;
    if (state.songId !== previous.songId && store().session) store().setSongId(state.songId);
  });

  // Any change to the session writes it, debounced; the changes are few, since nothing here
  // touches the store on a position update.
  const unsubscribePractice = practice.subscribe((state, previous) => {
    if (stopped || state.session === previous.session || !state.session) return;
    schedule();
  });

  // The last second before a window closes or reloads: IndexedDB starts the write synchronously,
  // so a flush from `pagehide` normally completes. `visibilitychange` covers Electron closing.
  const flush = () => {
    accrue();
    commitTempo();
    write();
    return writing;
  };
  const onHide = () => void flush();
  const onVisibility = () => {
    if (document_.visibilityState === 'hidden') void flush();
  };
  addEventListener('pagehide', onHide);
  document_.addEventListener('visibilitychange', onVisibility);

  const stop = () => {
    if (stopped) return writing;
    if (store().session) end();
    stopped = true;
    clearTimers();
    if (writeTimer !== undefined) clearTimeout(writeTimer);
    unsubscribePlayback();
    unsubscribeDocument();
    unsubscribePractice();
    removeEventListener('pagehide', onHide);
    document_.removeEventListener('visibilitychange', onVisibility);
    return writing;
  };

  // A session already running when the capture starts (the transport is mid-play) is picked up.
  if (selectRunning(playback.getState())) onTransport('stopped', playback.getState().transport);

  return { flush, stop };
}
