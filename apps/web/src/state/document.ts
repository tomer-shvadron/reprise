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

/** The formats Reprise can write; every other opened format is saved as a copy in one of these. */
export type SaveFormat = 'reprise' | 'gp';

const SAVE_FILTERS: Record<SaveFormat, readonly FileFilter[]> = {
  reprise: REPRISE_FILES,
  gp: GP_FILES,
};

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
  | { kind: 'overwrite'; fileName: string; losses: readonly Warning[] }
  /** Save As asks for the format before the platform dialog, which takes the bytes up front. */
  | { kind: 'save-as'; reason: string | undefined; gpLosses: readonly Warning[] };

export type SaveAnswer = 'cancel' | 'overwrite' | SaveFormat;

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

export interface DocumentError {
  action: 'open' | 'save';
  fileName: string;
  message: string;
  code?: string;
}

/**
 * What is shown, not what the score is: never undoable. Notation is the one part Save writes
 * (into each track's `display.notation`), so a change to it marks the document modified.
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

export interface DocumentState {
  /** A new one per opened document; subscribers tell a switch from an edit by it. */
  id: Id | undefined;
  score: Score | undefined;
  file: DocumentFile | undefined;
  view: DocumentView;
  /** The change that produced `score`; undefined right after an open. */
  lastChange: Change | undefined;
  revision: number;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | undefined;
  redoLabel: string | undefined;
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
  openBytes(name: string, bytes: Uint8Array, handle?: FileHandle): Promise<void>;
  close(): void;
  apply(command: Command): readonly CommandWarning[];
  undo(): void;
  redo(): void;
  save(): Promise<void>;
  saveAs(): Promise<void>;
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

/** The score as Save writes it: the view's notation folded into each track's display. */
export function withViewNotation(score: Score, notation: Record<Id, Notation>): Score {
  if (Object.keys(notation).length === 0) return score;
  return {
    ...score,
    tracks: score.tracks.map((track) => {
      const chosen = notation[track.id];
      return chosen === undefined || chosen === track.display.notation
        ? track
        : { ...track, display: { ...track.display, notation: chosen } };
    }),
  };
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

function saveAsReason(format: Format | undefined): string | undefined {
  if (format === undefined || isSaveFormat(format)) return undefined;
  return `Reprise can't write ${FORMAT_NAMES[format]} files, so this saves a copy as Reprise or as Guitar Pro 7–8.`;
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

  return create<DocumentState>()((set, get) => {
    const snapshot = (notation: Record<Id, Notation> = get().view.notation) => ({
      dirty: depth !== savedDepth || !sameNotation(notation, savedNotation),
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
    });

    const replay = (step: 'undo' | 'redo') => {
      const applied = step === 'undo' ? history.undo() : history.redo();
      if (!applied) return;
      depth += step === 'undo' ? -1 : 1;
      set((state) => ({
        score: applied.score,
        lastChange: applied.change,
        revision: state.revision + 1,
        ...snapshot(),
      }));
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

    const saveAs = async () => {
      const { score: current, file, saving, view } = get();
      if (!current || saving) return;
      const at = depth;
      const notation = view.notation;
      const score = withViewNotation(current, notation);
      const token = documentToken;
      const name = file ? baseName(file.name) : 'Untitled';
      let target = `${name}.reprise`;
      set({ saving: true });
      try {
        const gp = await write(score, 'gp');
        const answer = await ask({
          kind: 'save-as',
          reason: saveAsReason(file?.format),
          gpLosses: gp.dropped,
        });
        if (token !== documentToken || !isSaveFormat(answer)) return;
        target = `${name}.${answer}`;
        const { bytes } = answer === 'gp' ? gp : await write(score, 'reprise');
        const [path, savedKey] = await Promise.all([
          platform.saveFile(target, bytes, SAVE_FILTERS[answer]),
          contentKey(bytes),
        ]);
        // A cancel and a browser download look the same: nothing to write to again.
        if (path !== undefined && token === documentToken) {
          savedDepth = at;
          savedNotation = notation;
          if (answer === 'gp') originalHasMore = false;
          set({
            file: {
              name: lastSegment(path),
              format: answer,
              handle: path,
              key: file?.key ?? savedKey,
              savedKeys: [...(file?.savedKeys ?? []), savedKey],
            },
            ...snapshot(),
          });
        }
      } catch (error) {
        set({ error: errorOf('save', target, error) });
      } finally {
        set({ saving: false });
      }
    };

    return {
      id: undefined,
      score: undefined,
      file: undefined,
      view: emptyView(),
      lastChange: undefined,
      revision: 0,
      dirty: false,
      canUndo: false,
      canRedo: false,
      undoLabel: undefined,
      redoLabel: undefined,
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
        await get().openBytes(picked.name, picked.bytes, picked.handle);
      },

      async openBytes(name, bytes, handle) {
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
          savedDepth = 0;
          savedNotation = {};
          forgetDocument();
          set((state) => ({
            id: newId(),
            score,
            file:
              handle === undefined
                ? { name, format, key, savedKeys: [] }
                : { name, format, handle, key, savedKeys: [] },
            view: emptyView(),
            lastChange: undefined,
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
          view: emptyView(),
          lastChange: undefined,
          revision: state.revision + 1,
          warnings: [],
          warningsOpen: false,
          detailsOpen: false,
          opening: undefined,
          error: undefined,
          ...snapshot({}),
        }));
      },

      apply(command) {
        const { score } = get();
        if (!score) throw new Error('No document is open');
        const applied = history.apply(score, command);
        if (applied.change.patches.length === 0) return applied.warnings;
        if (depth < savedDepth) savedDepth = -1;
        depth += 1;
        set((state) => ({
          score: applied.score,
          lastChange: applied.change,
          revision: state.revision + 1,
          ...snapshot(),
        }));
        return applied.warnings;
      },

      undo() {
        replay('undo');
      },
      redo() {
        replay('redo');
      },

      async save() {
        const { score: current, file, saving, view } = get();
        if (!current || saving) return;
        const format = file?.format;
        if (file?.handle === undefined || !isSaveFormat(format)) {
          await saveAs();
          return;
        }
        const at = depth;
        const notation = view.notation;
        const token = documentToken;
        set({ saving: true });
        try {
          const { bytes, dropped } = await write(withViewNotation(current, notation), format);
          if (format === 'gp') {
            const losses = originalHasMore ? [...dropped, ...readLosses(get().warnings)] : dropped;
            if (losses.length > 0) {
              const answer = await ask({ kind: 'overwrite', fileName: file.name, losses });
              if (answer !== 'overwrite' || token !== documentToken) return;
            }
          }
          const [, savedKey] = await Promise.all([
            platform.writeHandle(file.handle, bytes),
            contentKey(bytes),
          ]);
          if (token !== documentToken) return;
          savedDepth = at;
          savedNotation = notation;
          if (format === 'gp') originalHasMore = false;
          set({ file: { ...file, savedKeys: [...file.savedKeys, savedKey] }, ...snapshot() });
        } catch (error) {
          set({ error: errorOf('save', file.name, error) });
        } finally {
          set({ saving: false });
        }
      },

      saveAs,

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
