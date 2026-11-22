/**
 * Export as image and Copy as image (#351): the dialog's state and the two flows. Neither is a
 * save: `dirty`, the file and `songId` never change. What the image covers follows the owner's
 * rulings: a whole score and a page draw the tracks on screen, a selection draws the edit
 * range's tracks (`selectionScope`, which the host builds from the selection and the menu's
 * target) and is cropped to its content.
 */
import type { Id } from '@reprise/model';
import { create } from 'zustand';

import { copyImage } from '@/lib/system-clipboard';
import type { Platform } from '@/platform/platform';
import { visibleTrackIds, type DocumentStore } from '@/state/document';
import type { UiStore } from '@/state/ui';

import {
  exportImages,
  pageOfBar,
  prepareImages,
  ExportCancelled,
  type ImageExportDeps,
  type ImageExportRequest,
  type ImageFormat,
  type ImageScale,
} from './image-export';
import { afterPaint } from '../print-store';
import type { ImageBackground } from './svg-page';
import type { PaperSize } from '../view-options';

export type ImageScopeKind = 'score' | 'page' | 'bars';

/** The bars (end exclusive) and tracks a selection stands for. */
export interface ImageSelection {
  tracks: Id[];
  bars: { start: number; end: number };
}

/** What the export dialog shows; the page field is kept as typed. */
export interface ImageDialog {
  scope: ImageScopeKind;
  pageText: string;
  /** The selected bars as 1-based, inclusive numbers; undefined when nothing is selected. */
  selectedBars: { first: number; last: number } | undefined;
  format: ImageFormat;
  scale: ImageScale;
  background: ImageBackground;
  paper: PaperSize;
  /** Set while exporting: pages done of total. */
  progress: { done: number; total: number } | undefined;
  /** Why the export failed, for the dialog to show. */
  error: string | undefined;
}

export type ImageDialogSettings = Pick<
  ImageDialog,
  'scope' | 'pageText' | 'format' | 'scale' | 'background' | 'paper'
>;

export interface ImageDialogState {
  dialog: ImageDialog | undefined;
}

export function createImageDialogStore() {
  return create<ImageDialogState>()(() => ({ dialog: undefined }));
}
export type ImageDialogStore = ReturnType<typeof createImageDialogStore>;

export interface ImageExporterDeps {
  document: DocumentStore;
  ui: UiStore;
  platform: Pick<Platform, 'saveFile'>;
  /**
   * The selection, or with `useTarget` the bar or range a context menu was opened on first;
   * undefined when nothing is selected.
   */
  selectionScope: (useTarget: boolean) => ImageSelection | undefined;
  /** The master bar (0-based) at the top of the score on screen; the page field starts there. */
  barInView?: () => number | undefined;
  /** Whether chord diagrams are drawn, read when the image is made so it follows the screen. */
  chordDiagrams?: () => boolean;
  /** Whether the chord strip is on, read the same way; the whole score and a page draw it. */
  chordStrip?: () => boolean;
  /** The current track, which the strip prefers. */
  currentTrack?: () => Id | undefined;
  notify: (message: string, kind?: 'error') => void;
  /** Resolves after the next paint, so the page lookup never delays the dialog; for tests. */
  nextPaint?: () => Promise<void>;
  /** Rendering overrides, for tests. */
  render?: Pick<ImageExportDeps, 'outlines' | 'rasterise' | 'yieldFrame'>;
}

export interface ImageExporter {
  store: ImageDialogStore;
  /** File > Export as image: opens the dialog. */
  open(): void;
  update(change: Partial<ImageDialogSettings>): void;
  /** Aborts a running export, else closes the dialog. */
  cancel(): void;
  /** The dialog's Export: renders and saves through the platform's save dialog. */
  submit(): Promise<void>;
  /** Copy as image: the selection as a 2x PNG on white. */
  copy(): Promise<void>;
}

/** The page in the field, or undefined when it is not a whole number of at least 1. */
export function parsePage(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+$/u.test(trimmed)) return undefined;
  const page = Number(trimmed);
  return page >= 1 ? page : undefined;
}

/** What Copy as image makes: a 2x PNG on white, as the owner chose. */
export const COPY_SCALE = 2;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createImageExporter(deps: ImageExporterDeps): ImageExporter {
  const { document, ui, platform, selectionScope, notify } = deps;
  const store = createImageDialogStore();
  // Remembered for the session, the way print remembers its settings.
  let remembered: Omit<ImageDialogSettings, 'scope' | 'pageText'> | undefined;
  let running: AbortController | undefined;
  // The bar on screen when the dialog opened, and whether the page field still follows it (the
  // user has not typed in it). The lookup lays the score out, so it runs only when the page scope
  // is in use, after a paint (#421).
  const follow: { bar: number | undefined; auto: boolean; job: number } = {
    bar: undefined,
    auto: true,
    job: 0,
  };
  const nextPaint = deps.nextPaint ?? afterPaint;

  const patch = (change: Partial<ImageDialog>) => {
    store.setState((state) => (state.dialog ? { dialog: { ...state.dialog, ...change } } : state));
  };

  const tracksOnScreen = (): Id[] => {
    const { score, view } = document.getState();
    if (!score) return [];
    const shown = visibleTrackIds(view, score);
    return score.tracks.map(({ id }) => id).filter((id) => shown === 'all' || shown.includes(id));
  };

  const requestOf = (
    dialog: ImageDialog,
    selection: ImageSelection | undefined,
  ): ImageExportRequest | undefined => {
    const { score, file, view } = document.getState();
    if (!score) return undefined;
    const bars = dialog.scope === 'bars' && selection ? selection : undefined;
    const page = parsePage(dialog.pageText);
    if (dialog.scope === 'page' && page === undefined) return undefined;
    return {
      score,
      fileName: file?.name,
      scope: bars
        ? { kind: 'bars', start: bars.bars.start, end: bars.bars.end }
        : dialog.scope === 'page' && page !== undefined
          ? { kind: 'page', page }
          : { kind: 'score' },
      format: dialog.format,
      scale: dialog.scale,
      background: dialog.background,
      paper: dialog.paper,
      tracks: bars ? bars.tracks : tracksOnScreen(),
      notation: view.notation,
      ...(deps.chordDiagrams && { chordDiagrams: deps.chordDiagrams() }),
      ...(deps.chordStrip && {
        chordStrip: deps.chordStrip(),
        currentTrack: deps.currentTrack?.(),
      }),
    };
  };

  const syncPage = async () => {
    const job = ++follow.job;
    if (!follow.auto || !follow.bar || store.getState().dialog?.scope !== 'page') return;
    await nextPaint();
    const dialog = store.getState().dialog;
    // Typing in the field bumps the job too, so a lookup in flight never overwrites it.
    if (job !== follow.job || !dialog || dialog.scope !== 'page') return;
    try {
      // As a whole score, so a half-typed page number cannot stop the lookup.
      const request = requestOf({ ...dialog, scope: 'score' }, undefined);
      if (request) patch({ pageText: String(pageOfBar(request, follow.bar)) });
    } catch (error) {
      // The field is a convenience: it stays as it is and the dialog keeps working.
      console.error(error);
    }
  };

  // Another file can open under the modal (a drop): the dialog is about the old score, so it goes.
  document.subscribe((next, previous) => {
    if (next.score !== previous.score && !running) store.setState({ dialog: undefined });
  });

  return {
    store,
    open() {
      if (!document.getState().score || store.getState().dialog) return;
      const bars = selectionScope(false)?.bars;
      const dialog: ImageDialog = {
        scope: bars ? 'bars' : 'score',
        pageText: '1',
        selectedBars: bars && { first: bars.start + 1, last: bars.end },
        format: remembered?.format ?? 'png',
        scale: remembered?.scale ?? 2,
        background: remembered?.background ?? 'white',
        paper: remembered?.paper ?? ui.getState().view.paper,
        progress: undefined,
        error: undefined,
      };
      follow.bar = deps.barInView?.();
      follow.auto = true;
      follow.job++;
      store.setState({ dialog });
    },
    update(change) {
      if (running) return;
      if (change.pageText !== undefined) {
        follow.auto = false;
        follow.job++;
      }
      patch({ ...change, error: undefined });
      if (change.scope === 'page' || change.paper !== undefined) void syncPage();
    },
    cancel() {
      if (running) running.abort();
      else store.setState({ dialog: undefined });
    },
    async submit() {
      const { dialog } = store.getState();
      if (!dialog || running) return;
      // `selectionScope` is read now, not at open: the selection may have moved since.
      const selection = selectionScope(false);
      if (dialog.scope === 'bars' && !selection) {
        // Exporting the whole score instead would hand over what was not asked for.
        patch({ error: 'The selected bars are gone. Choose another scope.' });
        return;
      }
      const request = requestOf(dialog, selection);
      if (!request || request.tracks.length === 0) return;
      const { format, scale, background, paper } = dialog;
      remembered = { format, scale, background, paper };
      const controller = new AbortController();
      running = controller;
      patch({ progress: { done: 0, total: 1 }, error: undefined });
      try {
        const result = await exportImages(request, {
          platform,
          ...deps.render,
          signal: controller.signal,
          onProgress: (progress) => {
            patch({ progress });
          },
        });
        store.setState({ dialog: undefined });
        if (result.status === 'saved' && result.path !== undefined) {
          const { files, fallbackTexts } = result;
          notify(
            `Exported ${String(files)} ${files === 1 ? 'image' : 'images'}.${
              fallbackTexts > 0
                ? ' Some text uses characters this export cannot outline and stays editable text.'
                : ''
            }`,
          );
        }
      } catch (error) {
        console.error(error);
        patch({ progress: undefined, error: `Could not export: ${message(error)}` });
      } finally {
        running = undefined;
      }
    },
    async copy() {
      // Before the first await: the host clears the menu target once `run` returns.
      const selection = selectionScope(true);
      const request = selection
        ? requestOf(
            {
              scope: 'bars',
              pageText: '1',
              selectedBars: undefined,
              format: 'png',
              scale: COPY_SCALE,
              background: 'white',
              paper: remembered?.paper ?? ui.getState().view.paper,
              progress: undefined,
              error: undefined,
            },
            selection,
          )
        : undefined;
      if (!request || !selection) {
        notify('Select some bars to copy them as an image.', 'error');
        return;
      }
      let pages = 1;
      const png = (async () => {
        const controller = new AbortController();
        const prepared = await prepareImages(request, {
          ...deps.render,
          signal: controller.signal,
        });
        pages = prepared.pageCount;
        let first: Uint8Array | undefined;
        try {
          await prepared.run((image) => {
            first ??= image.bytes;
            // A selection longer than a page copies the first page; the rest is not rendered.
            controller.abort();
          });
        } catch (error) {
          if (!(error instanceof ExportCancelled) || !first) throw error;
        }
        if (!first) throw new Error('the export made no image');
        return new Blob([new Uint8Array(first)], { type: 'image/png' });
      })();
      try {
        await copyImage(png);
        const bars = selection.bars.end - selection.bars.start;
        notify(
          pages > 1
            ? `Copied page 1 of ${String(pages)} as an image; the selection is longer than a page.`
            : `Copied ${String(bars)} ${bars === 1 ? 'bar' : 'bars'} as an image.`,
        );
      } catch (error) {
        notify(`Could not copy as an image: ${message(error)}`, 'error');
      }
    },
  };
}
