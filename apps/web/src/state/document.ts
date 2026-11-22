import {
  detect,
  FormatError,
  read as readScore,
  write as writeScore,
  type Format,
  type Warning,
} from '@reprise/formats';
import {
  createHistory,
  newId,
  shownNotation,
  type Change,
  type Command,
  type CommandWarning,
  type History,
  type Id,
  type Notation,
  type Score,
} from '@reprise/model';
import { create } from 'zustand';

import type { FileFilter, FileHandle, Platform } from '@/platform/platform';

export const SCORE_FILES: readonly FileFilter[] = [
  { name: 'Scores', extensions: ['reprise', 'gp', 'gpx', 'gp5', 'gp4', 'gp3'] },
];
export const REPRISE_FILES: readonly FileFilter[] = [{ name: 'Reprise', extensions: ['reprise'] }];
export const GP_FILES: readonly FileFilter[] = [{ name: 'Guitar Pro 7–8', extensions: ['gp'] }];

/** The formats Save writes in place; Save As writes `.reprise` only, and `.gp` is an export. */
export type SaveFormat = 'reprise' | 'gp';

export const FORMAT_NAMES: Record<Format, string> = {
  gp3: 'Guitar Pro 3 (.gp3)',
  gp4: 'Guitar Pro 4 (.gp4)',
  gp5: 'Guitar Pro 5 (.gp5)',
  gpx: 'Guitar Pro 6 (.gpx)',
  gp: 'Guitar Pro 7–8 (.gp)',
  reprise: 'Reprise (.reprise)',
};

export type SavePrompt =
  /** Overwriting a `.gp` loses these: the writer's drops, and what the read never kept. */
  { kind: 'overwrite'; fileName: string; losses: readonly Warning[] };

export type SaveAnswer = 'cancel' | 'overwrite';

/**
 * What a save started by `beginSave` holds until `finishSave`: the document it began on, the undo
 * depth and notation it captured, and `score`, the view-folded score a save writes.
 */
export interface SaveMark {
  readonly score: Score;
  readonly notation: Record<Id, Notation>;
  readonly depth: number;
  readonly token: number;
}

export type SaveOutcome =
  | {
      saved: { name: string; format: SaveFormat; handle: FileHandle; savedKey: string };
      /** Present (even as undefined) sets or clears `songId`; absent leaves it. */
      songId?: Id | undefined;
    }
  | { failed: unknown; fileName: string }
  | { cancelled: true };

/**
 * Takes over Save and Save As (the library's rules); `builtin` is the store's own path. A saver
 * must not call `builtin` while it holds a mark of its own (the built-in begins one), and must
 * not call `store.save()` or `store.saveAs()` from inside itself.
 */
export interface Saver {
  save(builtin: () => Promise<void>): Promise<void>;
  saveAs(builtin: () => Promise<void>): Promise<void>;
}

export interface DocumentFile {
  name: string;
  format: Format;
  /** The SHA-256 of the bytes as opened: the document's identity whatever the file is called. */
  key: string;
  /** The hashes of the bytes this document has saved since, so they are known as the same song. */
  savedKeys: readonly string[];
  /** From the platform's open or from a Save As; Save writes over it when the format is a `SaveFormat`. */
  handle?: FileHandle;
}

export interface OpenOptions {
  handle?: FileHandle;
  songId?: Id;
  /** Opens as unsaved (a recovered draft): the document stays modified until a save. */
  modified?: boolean;
}

export interface NewDocumentOptions {
  modified?: boolean;
}

export interface DocumentError {
  action: 'open' | 'save';
  fileName: string;
  message: string;
  code?: string;
}

/**
 * What is shown, not what the score is: never undoable. Notation is the one part Save writes
 * (into each track's `display.notation`, as the track shows it), so a change to it marks the
 * document modified.
 */
export interface DocumentView {
  /** The multitrack set; `'all'` follows tracks added later. */
  tracks: Id[] | 'all';
  /** Overrides of `display.notation`; an entry equal to the track's own is never kept. */
  notation: Record<Id, Notation>;
  /** The track shown alone in single-track view; absent in multitrack view. */
  only?: Id;
}

/** The part of the view a session keeps: which tracks are shown, not how they are written. */
export type TrackLayoutView = Omit<DocumentView, 'notation'>;

/** The command names on each undo stack, newest first; a group or chain shows its own name. */
export interface HistoryLabels {
  undo: readonly string[];
  redo: readonly string[];
}

/** What last moved the history, so the editor can put the cursor back after an undo. */
export type HistoryStep = 'apply' | 'undo' | 'redo';

const noLabels: HistoryLabels = { undo: [], redo: [] };

export interface DocumentState {
  /** A new one per opened document; subscribers tell a switch from an edit by it. */
  id: Id | undefined;
  score: Score | undefined;
  file: DocumentFile | undefined;
  /**
   * The library song this document was opened from or imported as; undefined for a file opened
   * without importing. Set by the library (WP-060), read by Save (WP-061) and the practice log
   * (WP-073). Never undoable and never marks the document modified.
   */
  songId: Id | undefined;
  view: DocumentView;
  /**
   * The change that produced `score`; undefined right after an open. After a jump it is the merge
   * of the replayed steps: `touchedBars` is safe to use, but the patch paths address intermediate
   * scores, not positions in `score`; use `lastReplayed` for those.
   */
  lastChange: Change | undefined;
  /**
   * After an undo or redo (`lastStep`), the last step it replayed: `lastChange` itself after one
   * step, the step nearest the target after a jump. Undefined after an apply, an open or a close.
   */
  lastReplayed: Change | undefined;
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
  /** Every step's name, newest first; the same object while neither list has changed. */
  historyLabels: HistoryLabels;
  /** `apply`, `undo` or `redo`, whichever produced `score` last; undefined after an open or close. */
  lastStep: HistoryStep | undefined;
  /** From the last successful read. */
  warnings: readonly Warning[];
  warningsOpen: boolean;
  /** Whether the warnings notice shows its list; reset by every open. */
  detailsOpen: boolean;
  /** A question the pending save waits on; `answerSavePrompt` settles it. */
  savePrompt: SavePrompt | undefined;
  /** The name of the file being read. */
  opening: string | undefined;
  saving: boolean;
  error: DocumentError | undefined;
  open(): Promise<void>;
  /** `songId` ties the document to its library song from the first render. */
  openBytes(name: string, bytes: Uint8Array, options?: OpenOptions): Promise<void>;
  /** Ties the open document to a library song, as after importing a file opened without import. */
  setSongId(songId: Id | undefined): void;
  /**
   * Opens a never-saved document around `score` (the caller builds it, e.g. `createEmptyScore()`):
   * fresh history, no file, no `songId`, not modified unless `modified` (a recovered draft). Save
   * falls through to Save As for it.
   */
  newDocument(score: Score, options?: NewDocumentOptions): void;
  close(): void;
  apply(command: Command): readonly CommandWarning[];
  /**
   * Moves |n| steps through the history, undo for n < 0 and redo for n > 0, clamped to the stack,
   * with one publish. Returns how many steps it replayed (0: nothing changed, nothing published).
   */
  step(n: number): number;
  undo(): void;
  redo(): void;
  /** Through the installed saver, else the built-in. */
  save(): Promise<void>;
  /** Through the installed saver, else the built-in, which writes `.reprise` only. */
  saveAs(): Promise<void>;
  /**
   * Starts a save: captures the document, undo depth, notation and the view-folded score, and sets
   * `saving`. Undefined when nothing is open or a save is running.
   */
  beginSave(): SaveMark | undefined;
  /**
   * Ends a save and always clears `saving`. Commits the saved point (and `file`, `songId`) only
   * while the mark's document is still open, returning whether it did; an edit made since stays
   * dirty.
   */
  finishSave(mark: SaveMark, outcome: SaveOutcome): boolean;
  /** Installs (or, with undefined, removes) the saver `save` and `saveAs` go through. */
  setSaver(saver: Saver | undefined): void;
  setVisibleTracks(tracks: Id[] | 'all'): void;
  setNotation(trackId: Id, notation: Notation | undefined): void;
  /** Single-track view of `id`, or multitrack view with `undefined`. */
  setSingleTrack(id: Id | undefined): void;
  /**
   * Replaces the multitrack set and the single track in one set. Notation is the file's, so it is
   * kept as it is and the modified flag never moves.
   */
  setView(view: TrackLayoutView): void;
  setWarningsOpen(open: boolean): void;
  setDetailsOpen(open: boolean): void;
  /** Reopens the warnings notice with its list expanded. */
  showImportDetails(): void;
  answerSavePrompt(answer: SaveAnswer): void;
  dismissError(): void;
  /** Sets an open error from outside the read, such as a dropped file that is too large. */
  failOpen(fileName: string, message: string, code?: string): void;
}

export interface DocumentStoreDeps {
  platform: Pick<Platform, 'openFile' | 'saveFile' | 'writeHandle'>;
  read?: typeof readScore;
  write?: typeof writeScore;
}

const emptyView = (): DocumentView => ({ tracks: 'all', notation: {} });

/** The single-track view's track while the score still has it. */
export function singleTrackOf(view: DocumentView, score: Score | undefined): Id | undefined {
  const { only } = view;
  return only !== undefined && score?.tracks.some((track) => track.id === only) ? only : undefined;
}

/** The tracks to lay out: the single track, else the multitrack set the score still has. */
export function visibleTrackIds(view: DocumentView, score: Score | undefined): Id[] | 'all' {
  if (!score) return view.tracks;
  const only = singleTrackOf(view, score);
  if (only !== undefined) return [only];
  if (view.tracks === 'all') return 'all';
  const wanted = new Set(view.tracks);
  const kept = score.tracks.filter((track) => wanted.has(track.id)).map((track) => track.id);
  return kept.length > 0 ? kept : 'all';
}

/**
 * The score as Save writes it: the notation each track shows folded into its display, so a track
 * without strings a file asked to show as tab is saved as standard. Unchanged, the same object.
 */
export function withViewNotation(score: Score, notation: Record<Id, Notation>): Score {
  const tracks = score.tracks.map((track) => {
    const saved = shownNotation(track, notation[track.id] ?? track.display.notation);
    return saved === track.display.notation
      ? track
      : { ...track, display: { ...track.display, notation: saved } };
  });
  return tracks.every((track, index) => track === score.tracks[index])
    ? score
    : { ...score, tracks };
}

function sameNotation(a: Record<Id, Notation>, b: Record<Id, Notation>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

function errorOf(action: DocumentError['action'], fileName: string, error: unknown): DocumentError {
  if (error instanceof FormatError) {
    return { action, fileName, message: error.message, code: error.code };
  }
  console.error(error);
  return { action, fileName, message: error instanceof Error ? error.message : String(error) };
}

function baseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function lastSegment(path: string): string {
  return path.split(/[/\\]/).pop() ?? path;
}

/** Hex SHA-256 of `bytes`; `crypto.subtle` hashes off the main thread. */
export async function contentKey(bytes: Uint8Array): Promise<string> {
  // A copy into a plain ArrayBuffer, since `digest` refuses a view over a SharedArrayBuffer.
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function isSaveFormat(format: string | undefined): format is SaveFormat {
  return format === 'reprise' || format === 'gp';
}

/** What the read did not keep, which an overwrite of the original therefore loses. */
export function readLosses(warnings: readonly Warning[]): Warning[] {
  return warnings.filter(
    (warning) => warning.severity === 'info' || warning.code.endsWith('-dropped'),
  );
}

/**
 * `features/library/paths.ts` is the only place that makes `library/` paths (it cannot be
 * imported here). A string handle under `library/` with no `songId` points at a deleted song, so
 * the document has no handle at all.
 */
function hasUsableHandle(file: DocumentFile | undefined, songId: Id | undefined): boolean {
  if (file?.handle === undefined) return false;
  return !(
    typeof file.handle === 'string' &&
    songId === undefined &&
    file.handle.startsWith('library/')
  );
}

export function createDocumentStore(deps: DocumentStoreDeps) {
  const { platform, read = readScore, write = writeScore } = deps;
  let history: History = createHistory();
  // Undo depth, and the depth the file on disk matches; -1 once that point cannot be reached.
  let depth = 0;
  let savedDepth = 0;
  // The view's notation as last saved: Save writes it, so a change since makes the document dirty.
  let savedNotation: Record<Id, Notation> = {};
  let openToken = 0;
  // Bumped by every open and close, so a save that outlives its document drops its result.
  let documentToken = 0;
  // Whether the file on disk still holds what the read dropped; false once Reprise wrote it as gp.
  let originalHasMore = true;
  let resolvePrompt: ((answer: SaveAnswer) => void) | undefined;
  let saver: Saver | undefined;
  // The save in flight, single-use: only its own mark can finish it.
  let openMark: SaveMark | undefined;
  // False once an edit follows an undo below the mark's depth: that history point is gone.
  let markReachable = true;

  return create<DocumentState>()((set, get) => {
    // Keeps the previous object when nothing changed, so a subscriber can compare by identity;
    // the history hands back the same arrays while a stack is unchanged.
    const labelsNow = (): HistoryLabels => {
      const previous = get().historyLabels;
      const undo = history.undoLabels;
      const redo = history.redoLabels;
      return undo === previous.undo && redo === previous.redo ? previous : { undo, redo };
    };

    const snapshot = (notation: Record<Id, Notation> = get().view.notation) => ({
      dirty: depth !== savedDepth || !sameNotation(notation, savedNotation),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
      historyLabels: labelsNow(),
    });

    const step = (n: number): number => {
      const replayed = history.step(n);
      if (!replayed) return 0;
      depth += Math.sign(n) * replayed.count;
      set((state) => ({
        score: replayed.score,
        lastChange: replayed.change,
        lastReplayed: replayed.last,
        lastStep: n < 0 ? 'undo' : 'redo',
        revision: state.revision + 1,
        ...snapshot(),
      }));
      return replayed.count;
    };

    const ask = (prompt: SavePrompt) =>
      new Promise<SaveAnswer>((resolve) => {
        resolvePrompt = resolve;
        set({ savePrompt: prompt });
      });

    const settlePrompt = (answer: SaveAnswer) => {
      const resolve = resolvePrompt;
      resolvePrompt = undefined;
      if (get().savePrompt !== undefined) set({ savePrompt: undefined });
      resolve?.(answer);
    };

    const forgetDocument = () => {
      documentToken += 1;
      originalHasMore = true;
      settlePrompt('cancel');
    };

    const beginSave = (): SaveMark | undefined => {
      const { score, saving, view } = get();
      if (!score || saving) return undefined;
      set({ saving: true });
      markReachable = true;
      openMark = {
        score: withViewNotation(score, view.notation),
        notation: view.notation,
        depth,
        token: documentToken,
      };
      return openMark;
    };

    // Frees a mark a failing saver left open, so `saving` cannot stay stuck.
    const releaseMark = () => {
      openMark = undefined;
      if (get().saving) set({ saving: false });
    };

    const finishSave = (mark: SaveMark, outcome: SaveOutcome): boolean => {
      if (mark !== openMark) return false;
      openMark = undefined;
      if (mark.token !== documentToken) {
        set({ saving: false });
        return false;
      }
      if ('saved' in outcome) {
        const { name, format, handle, savedKey } = outcome.saved;
        const { file } = get();
        // An edit after an undo below the mark made its depth unreachable: still modified.
        savedDepth = markReachable ? mark.depth : -1;
        savedNotation = mark.notation;
        if (format === 'gp') originalHasMore = false;
        set({
          file: {
            name,
            format,
            handle,
            key: file?.key ?? savedKey,
            savedKeys: [...(file?.savedKeys ?? []), savedKey],
          },
          ...('songId' in outcome ? { songId: outcome.songId } : {}),
          saving: false,
          ...snapshot(),
        });
      } else if ('failed' in outcome) {
        set({ error: errorOf('save', outcome.fileName, outcome.failed), saving: false });
      } else {
        set({ saving: false });
      }
      return true;
    };

    const viaSaver = async (run: () => Promise<void>) => {
      try {
        await run();
      } catch (error) {
        const { file } = get();
        set({ error: errorOf('save', file?.name ?? 'Untitled', error) });
        releaseMark();
      }
    };

    const builtinSaveAs = async () => {
      const mark = beginSave();
      if (!mark) return;
      const { file } = get();
      const target = `${file ? baseName(file.name) : 'Untitled'}.reprise`;
      try {
        const { bytes } = await write(mark.score, 'reprise');
        const [path, savedKey] = await Promise.all([
          platform.saveFile(target, bytes, REPRISE_FILES),
          contentKey(bytes),
        ]);
        // A cancel and a browser download look the same: nothing to write to again.
        finishSave(
          mark,
          path === undefined
            ? { cancelled: true }
            : {
                saved: { name: lastSegment(path), format: 'reprise', handle: path, savedKey },
                // Save As detaches the document from its library song.
                songId: undefined,
              },
        );
      } catch (error) {
        finishSave(mark, { failed: error, fileName: target });
      }
    };

    const builtinSave = async () => {
      const { file, songId } = get();
      const format = file?.format;
      if (!file || !hasUsableHandle(file, songId) || !isSaveFormat(format)) {
        await builtinSaveAs();
        return;
      }
      const { handle } = file;
      if (handle === undefined) return;
      const mark = beginSave();
      if (!mark) return;
      try {
        const { bytes, dropped } = await write(mark.score, format);
        if (format === 'gp') {
          const losses = originalHasMore ? [...dropped, ...readLosses(get().warnings)] : dropped;
          if (losses.length > 0) {
            const answer = await ask({ kind: 'overwrite', fileName: file.name, losses });
            if (answer !== 'overwrite') {
              finishSave(mark, { cancelled: true });
              return;
            }
          }
        }
        const [, savedKey] = await Promise.all([
          platform.writeHandle(handle, bytes),
          contentKey(bytes),
        ]);
        finishSave(mark, { saved: { name: file.name, format, handle, savedKey } });
      } catch (error) {
        finishSave(mark, { failed: error, fileName: file.name });
      }
    };

    return {
      id: undefined,
      score: undefined,
      file: undefined,
      songId: undefined,
      view: emptyView(),
      lastChange: undefined,
      lastReplayed: undefined,
      revision: 0,
      dirty: false,
      canUndo: false,
      canRedo: false,
      undoLabel: undefined,
      redoLabel: undefined,
      historyLabels: noLabels,
      lastStep: undefined,
      warnings: [],
      warningsOpen: false,
      detailsOpen: false,
      savePrompt: undefined,
      opening: undefined,
      saving: false,
      error: undefined,

      async open() {
        let picked;
        try {
          picked = await platform.openFile(SCORE_FILES);
        } catch (error) {
          set({ error: errorOf('open', 'the file', error) });
          return;
        }
        if (!picked) return;
        await get().openBytes(
          picked.name,
          picked.bytes,
          picked.handle === undefined ? {} : { handle: picked.handle },
        );
      },

      async openBytes(name, bytes, options = {}) {
        const { handle, songId, modified = false } = options;
        const token = ++openToken;
        set({ opening: name, error: undefined });
        try {
          const format = detect(bytes);
          if (format === undefined) {
            throw new FormatError('unknown-format', 'Not a Guitar Pro or Reprise file');
          }
          const [{ score, warnings }, key] = await Promise.all([read(bytes), contentKey(bytes)]);
          if (token !== openToken) return;
          history = createHistory();
          depth = 0;
          savedDepth = modified ? -1 : 0;
          savedNotation = {};
          forgetDocument();
          set((state) => ({
            id: newId(),
            score,
            file:
              handle === undefined
                ? { name, format, key, savedKeys: [] }
                : { name, format, handle, key, savedKeys: [] },
            songId,
            view: emptyView(),
            lastChange: undefined,
            lastReplayed: undefined,
            lastStep: undefined,
            revision: state.revision + 1,
            warnings,
            warningsOpen: warnings.some((warning) => warning.severity !== 'info'),
            detailsOpen: false,
            opening: undefined,
            ...snapshot({}),
          }));
        } catch (error) {
          if (token !== openToken) return;
          set({ opening: undefined, error: errorOf('open', name, error) });
        }
      },

      newDocument(score, options = {}) {
        // Drops an open still reading, so it cannot replace this document when it lands.
        openToken += 1;
        history = createHistory();
        depth = 0;
        savedDepth = options.modified === true ? -1 : 0;
        savedNotation = {};
        forgetDocument();
        set((state) => ({
          id: newId(),
          score,
          file: undefined,
          songId: undefined,
          view: emptyView(),
          lastChange: undefined,
          lastReplayed: undefined,
          lastStep: undefined,
          revision: state.revision + 1,
          warnings: [],
          warningsOpen: false,
          detailsOpen: false,
          opening: undefined,
          error: undefined,
          ...snapshot({}),
        }));
      },

      close() {
        openToken += 1;
        forgetDocument();
        history = createHistory();
        depth = 0;
        savedDepth = 0;
        savedNotation = {};
        set((state) => ({
          id: undefined,
          score: undefined,
          file: undefined,
          songId: undefined,
          view: emptyView(),
          lastChange: undefined,
          lastReplayed: undefined,
          lastStep: undefined,
          revision: state.revision + 1,
          warnings: [],
          warningsOpen: false,
          detailsOpen: false,
          opening: undefined,
          error: undefined,
          ...snapshot({}),
        }));
      },

      setSongId(songId) {
        if (get().score) set({ songId });
      },

      apply(command) {
        const { score } = get();
        if (!score) throw new Error('No document is open');
        const applied = history.apply(score, command);
        if (applied.change.patches.length === 0) return applied.warnings;
        if (depth < savedDepth) savedDepth = -1;
        if (openMark && depth < openMark.depth) markReachable = false;
        depth += 1;
        set((state) => ({
          score: applied.score,
          lastChange: applied.change,
          lastReplayed: undefined,
          lastStep: 'apply',
          revision: state.revision + 1,
          ...snapshot(),
        }));
        return applied.warnings;
      },

      step,
      undo() {
        step(-1);
      },
      redo() {
        step(1);
      },

      async save() {
        await viaSaver(() => (saver ? saver.save(builtinSave) : builtinSave()));
      },

      async saveAs() {
        await viaSaver(() => (saver ? saver.saveAs(builtinSaveAs) : builtinSaveAs()));
      },

      beginSave,
      finishSave,

      setSaver(next) {
        saver = next;
      },

      setVisibleTracks(tracks) {
        set((state) => ({ view: { ...state.view, tracks } }));
      },

      setNotation(trackId, notation) {
        const { view, score } = get();
        const own = score?.tracks.find((track) => track.id === trackId)?.display.notation;
        const kept = notation === own ? undefined : notation;
        if (view.notation[trackId] === kept) return;
        const rest = Object.fromEntries(
          Object.entries(view.notation).filter(([id]) => id !== trackId),
        );
        const next = kept === undefined ? rest : { ...rest, [trackId]: kept };
        set({ view: { ...view, notation: next }, dirty: snapshot(next).dirty });
      },

      setSingleTrack(id) {
        const { view } = get();
        if (view.only === id) return;
        const next: DocumentView = { tracks: view.tracks, notation: view.notation };
        if (id !== undefined) next.only = id;
        set({ view: next });
      },

      setView({ tracks, only }) {
        const { notation } = get().view;
        set({ view: only === undefined ? { tracks, notation } : { tracks, notation, only } });
      },

      setWarningsOpen(open) {
        set(open ? { warningsOpen: true } : { warningsOpen: false, detailsOpen: false });
      },

      setDetailsOpen(open) {
        set({ detailsOpen: open });
      },

      showImportDetails() {
        set({ warningsOpen: true, detailsOpen: true });
      },

      answerSavePrompt(answer) {
        settlePrompt(answer);
      },

      dismissError() {
        set({ error: undefined });
      },

      failOpen(fileName, message, code) {
        set({
          error:
            code === undefined
              ? { action: 'open', fileName, message }
              : { action: 'open', fileName, message, code },
        });
      },
    };
  });
}

export type DocumentStore = ReturnType<typeof createDocumentStore>;
