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
  /** From the platform's open or from a Save As; Save writes over it when the format is a `SaveFormat`. */
  handle?: FileHandle;
}

export interface DocumentError {
  action: 'open' | 'save';
  fileName: string;
  message: string;
  code?: string;
}

/** What is shown, not what the score is: never undoable and never dirtying. */
export interface DocumentView {
  tracks: Id[] | 'all';
  notation: Record<Id, Notation>;
}

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
  let openToken = 0;
  // Bumped by every open and close, so a save that outlives its document drops its result.
  let documentToken = 0;
  // Whether the file on disk still holds what the read dropped; false once Reprise wrote it as gp.
  let originalHasMore = true;
  let resolvePrompt: ((answer: SaveAnswer) => void) | undefined;

  return create<DocumentState>()((set, get) => {
    const snapshot = () => ({
      dirty: depth !== savedDepth,
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
      const { score, file, saving } = get();
      if (!score || saving) return;
      const at = depth;
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
        const path = await platform.saveFile(target, bytes, SAVE_FILTERS[answer]);
        // A cancel and a browser download look the same: nothing to write to again.
        if (path !== undefined && token === documentToken) {
          savedDepth = at;
          if (answer === 'gp') originalHasMore = false;
          set({
            file: { name: lastSegment(path), format: answer, handle: path },
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
          const { score, warnings } = await read(bytes);
          if (token !== openToken) return;
          history = createHistory();
          depth = 0;
          savedDepth = 0;
          forgetDocument();
          set((state) => ({
            id: newId(),
            score,
            file: handle === undefined ? { name, format } : { name, format, handle },
            view: emptyView(),
            lastChange: undefined,
            revision: state.revision + 1,
            warnings,
            warningsOpen: warnings.some((warning) => warning.severity !== 'info'),
            detailsOpen: false,
            opening: undefined,
            ...snapshot(),
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
          ...snapshot(),
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
        const { score, file, saving } = get();
        if (!score || saving) return;
        const format = file?.format;
        if (file?.handle === undefined || !isSaveFormat(format)) {
          await saveAs();
          return;
        }
        const at = depth;
        const token = documentToken;
        set({ saving: true });
        try {
          const { bytes, dropped } = await write(score, format);
          if (format === 'gp') {
            const losses = originalHasMore ? [...dropped, ...readLosses(get().warnings)] : dropped;
            if (losses.length > 0) {
              const answer = await ask({ kind: 'overwrite', fileName: file.name, losses });
              if (answer !== 'overwrite' || token !== documentToken) return;
            }
          }
          await platform.writeHandle(file.handle, bytes);
          if (token !== documentToken) return;
          savedDepth = at;
          if (format === 'gp') originalHasMore = false;
          set(snapshot());
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
        set((state) => {
          const rest = Object.fromEntries(
            Object.entries(state.view.notation).filter(([id]) => id !== trackId),
          );
          const next = notation === undefined ? rest : { ...rest, [trackId]: notation };
          return { view: { ...state.view, notation: next } };
        });
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
