import type { Id } from '@reprise/model';

import type { DocumentStore } from '@/state/document';
import type { EditingStore } from '@/state/editing';
import type { EditCursor, SelectionStore } from '@/state/selection';

import { commitEdit } from './commit';
import { LAST_DRUM_KEY } from './drum-lanes';
import { cursorAtTick, cursorTick, resolveCursor } from './cursor';
import {
  planAppendBar,
  planEntry,
  type EntryAction,
  type EntryInput,
  type EntryPlan,
} from './entry';
import type { EntryStore } from './entry-store';
import { previewOptions, type PreviewSound } from './preview';
import { rhythmOf, sameRhythm } from './rhythm';
import { visibleTracks } from './visible';

/** How long a first digit that could start a two-digit fret waits for the second. */
export const TWO_DIGIT_MS = 500;

export interface EntryClock {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface EntryDeps {
  document: DocumentStore;
  selection: SelectionStore;
  editing: EditingStore;
  entry: EntryStore;
  /** Sounds the note just entered; called after the edit, never before, since it may throw. */
  preview: (
    trackId: Id,
    note: { string: number; fret: number },
    options?: { velocity?: number; seconds?: number },
  ) => void;
  /** Where the capture-phase key and pointer listeners go; the window by default. */
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  clock?: EntryClock;
}

export interface EntryController {
  /** A fret digit typed at the cursor, with the two-digit rule. */
  fret(digit: number): void;
  act(action: EntryAction): void;
  /** Moves the cursor to the next stop, or appends a bar at the end of a full last bar. */
  appendBar(): boolean;
  /** Moves the cursor to `voice` (0 to 3) at the same bar and onset. */
  setVoice(voice: number): void;
  /** Commits a waiting digit now. */
  flush(): void;
  /** Drops a waiting digit; returns whether there was one. */
  cancel(): boolean;
}

const controllers = new WeakMap<EntryStore, EntryController>();

/** The controller `installEntry` made for `entry`; undefined before it ran and after its cleanup. */
export function entryController(entry: EntryStore): EntryController | undefined {
  return controllers.get(entry);
}

const defaultClock: EntryClock = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export const MODIFIER_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

const sameSpot = (a: EditCursor, b: EditCursor) =>
  a.track === b.track &&
  a.masterBar === b.masterBar &&
  a.voice === b.voice &&
  a.beat === b.beat &&
  a.string === b.string &&
  a.pitch === b.pitch;

/**
 * Turns the edit cursor and the entry keys into edits. It owns the two-digit timer, applies every
 * entry as one command through `commitEdit` (one undo step), mirrors the rhythm of the beat under
 * the cursor into the entry store, and flushes a waiting digit on any other key or click, which it
 * sees in the capture phase, ahead of the shortcut dispatcher. Returns the cleanup.
 */
export function installEntry(deps: EntryDeps): () => void {
  const { document, selection, editing, entry, preview } = deps;
  const clock = deps.clock ?? defaultClock;
  const target = deps.target ?? globalThis.window;
  let timer: unknown;

  const stopTimer = () => {
    if (timer !== undefined) clock.clear(timer);
    timer = undefined;
  };

  const context = (requireEditing = true) => {
    const { score, view } = document.getState();
    const { cursor } = selection.getState();
    if (!score || !cursor || (requireEditing && !editing.getState().editing)) return undefined;
    return { score, cursor, visible: visibleTracks(score, view) };
  };

  const inputFor = (
    cursor: EditCursor,
    score: NonNullable<ReturnType<typeof context>>['score'],
  ): EntryInput => {
    const { rhythm, mode, inserted } = entry.getState();
    return {
      score,
      cursor,
      rhythm,
      mode,
      inserted,
      state: selection.getState(),
      visible: visibleTracks(score, document.getState().view),
    };
  };

  const sound = (plan: PreviewSound) => {
    try {
      const { score } = document.getState();
      const options = score ? previewOptions(score, plan) : {};
      preview(plan.track, { string: plan.string, fret: plan.fret }, options);
    } catch (error) {
      // The edit is done; a refused preview must not look like a failed entry.
      console.error(error);
    }
  };

  /** Applies a plan made at `cursor`; the cursor follows only while it is still there. */
  const run = (plan: EntryPlan, cursor: EditCursor) => {
    if ('refused' in plan) {
      entry.getState().setMessage(plan.refused);
      return;
    }
    if ('nothing' in plan) return;
    if ('rhythm' in plan) {
      entry.getState().setRhythm(plan.rhythm);
      entry.getState().setMessage(undefined);
      return;
    }
    const current = selection.getState().cursor;
    const applied = commitEdit({ document, selection, entry }, plan.command, {
      base: cursor,
      moveCursor: current !== undefined && sameSpot(current, cursor),
      ...(plan.land && { land: plan.land }),
      ...(plan.inserted && { inserted: plan.inserted }),
      ...(plan.lane !== undefined && { lane: plan.lane }),
    });
    // Last, so a throw from the audio side cannot skip the edit.
    if (applied && plan.sound) {
      sound(plan.sound);
    }
  };

  const enter = (fret: number, cursor: EditCursor) => {
    const c = context(false);
    if (c) run(planEntry(inputFor(cursor, c.score), { kind: 'fret', fret }), cursor);
  };

  const track = (trackId: Id) => document.getState().score?.tracks.find(({ id }) => id === trackId);

  /** The largest number a track takes: its frets, or the highest GM key; none on a pitched track. */
  const maxValueOf = (trackId: Id): number => {
    const found = track(trackId);
    if (found?.kind === 'drums') return LAST_DRUM_KEY;
    return found?.kind === 'fretted' ? found.fretCount : 0;
  };

  const clearPending = () => {
    stopTimer();
    entry.getState().setPending(undefined);
  };

  const flush = () => {
    const { pending } = entry.getState();
    if (!pending) return;
    clearPending();
    // Replayed at its own beat only: a beat the score lost would resolve to a neighbour.
    const { score } = document.getState();
    if (score && resolveCursor(score, pending.cursor)?.exact) enter(pending.fret, pending.cursor);
  };

  const start = (digit: number, cursor: EditCursor) => {
    // A 0 on a drum or keyboard track is the lane's own note, as it is the open string on a fretted one.
    const kind = track(cursor.track)?.kind;
    if (digit === 0 && kind !== undefined && kind !== 'fretted') {
      const c = context(false);
      if (c) run(planEntry(inputFor(cursor, c.score), { kind: 'lane' }), cursor);
      return;
    }
    if (digit > 0 && digit * 10 <= maxValueOf(cursor.track)) {
      entry.getState().setPending({ fret: digit, cursor });
      stopTimer();
      timer = clock.set(() => {
        timer = undefined;
        flush();
      }, TWO_DIGIT_MS);
      return;
    }
    enter(digit, cursor);
  };

  const controller: EntryController = {
    fret(digit) {
      const c = context();
      if (!c) return;
      const { pending } = entry.getState();
      if (pending) {
        const value = pending.fret * 10 + digit;
        if (value <= maxValueOf(pending.cursor.track)) {
          clearPending();
          enter(value, pending.cursor);
          return;
        }
        if (track(pending.cursor.track)?.kind === 'drums') {
          // Two digits typed: refuse the number as typed, not the first digit and then the second.
          clearPending();
          enter(value, pending.cursor);
          return;
        }
        flush();
        const after = context();
        if (after) start(digit, after.cursor);
        return;
      }
      start(digit, c.cursor);
    },
    act(action) {
      flush();
      const c = context();
      if (c) run(planEntry(inputFor(c.cursor, c.score), action), c.cursor);
    },
    appendBar() {
      flush();
      const c = context();
      const plan = c && planAppendBar(c.score, c.cursor);
      if (!c || !plan) return false;
      run(plan, c.cursor);
      return true;
    },
    setVoice(voice) {
      flush();
      const c = context();
      const at = c && resolveCursor(c.score, c.cursor);
      const tick = c && cursorTick(c.score, c.cursor);
      if (!c || !at || tick === undefined || at.voice === voice) return;
      const cursor = cursorAtTick(c.score, at.track, at.bar, tick, voice, c.cursor);
      if (cursor) selection.getState().setEdit({ cursor });
    },
    flush,
    cancel() {
      const had = entry.getState().pending !== undefined;
      clearPending();
      return had;
    },
  };
  controllers.set(entry, controller);

  const mirrorRhythm = () => {
    const c = context(false);
    const at = c && resolveCursor(c.score, c.cursor);
    const beat = at && c.score.tracks[at.track]?.bars[at.bar]?.voices[at.voice]?.beats[at.stop];
    if (!beat) return;
    const rhythm = rhythmOf(beat);
    if (!sameRhythm(entry.getState().rhythm, rhythm)) entry.getState().setRhythm(rhythm);
  };

  const stopDocument = document.subscribe((state, previous) => {
    if (state.id !== previous.id) {
      clearPending();
      entry.getState().setInserted(undefined);
      entry.getState().setMessage(undefined);
      return;
    }
    if (state.score === previous.score) return;
    // A waiting digit replays at the beat it was typed at; if the score moved under it, that beat
    // is no longer certain, so it is dropped rather than landing somewhere else.
    const { pending } = entry.getState();
    if (pending && state.score && !resolveCursor(state.score, pending.cursor)?.exact)
      clearPending();
    mirrorRhythm();
  });

  const stopSelection = selection.subscribe((state, previous) => {
    const { cursor } = state;
    if (cursor === previous.cursor) return;
    entry.getState().setMessage(undefined);
    const { inserted, pending } = entry.getState();
    if (inserted !== undefined && cursor?.beat !== inserted)
      entry.getState().setInserted(undefined);
    if (pending && (!cursor || !sameSpot(cursor, pending.cursor))) flush();
    mirrorRhythm();
  });

  const stopEditing = editing.subscribe((state, previous) => {
    if (previous.editing && !state.editing) flush();
  });

  const onKey = (event: KeyboardEvent) => {
    if (!entry.getState().pending || MODIFIER_KEYS.has(event.key)) return;
    if (event.key === 'Escape') {
      cancelPending(event);
      return;
    }
    const bare = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
    // By the printed digit or the physical key, as the fret commands match it, so a layout whose
    // digit row prints something else (AZERTY) still joins the waiting digit.
    if (bare && (/^\d$/.test(event.key) || /^Digit\d$/.test(event.code))) return;
    flush();
  };
  const cancelPending = (event: KeyboardEvent) => {
    controller.cancel();
    // So the Escape that cancelled does not also clear the selection.
    event.preventDefault();
  };
  const onPointer = () => {
    flush();
  };
  target.addEventListener('keydown', onKey as EventListener, true);
  target.addEventListener('pointerdown', onPointer, true);

  return () => {
    target.removeEventListener('keydown', onKey as EventListener, true);
    target.removeEventListener('pointerdown', onPointer, true);
    stopDocument();
    stopSelection();
    stopEditing();
    stopTimer();
    controllers.delete(entry);
  };
}
