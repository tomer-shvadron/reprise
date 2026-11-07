import type { layout as layoutScore } from '@reprise/layout';
import type { Id } from '@reprise/model';
import { create } from 'zustand';

import type { Platform } from '@/platform/platform';
import { visibleTrackIds, type DocumentStore } from '@/state/document';
import type { UiStore } from '@/state/ui';

import { loadScoreFonts } from './fonts';
import { layoutForPrint, type PrintContent, type PrintSettings } from './print-layout';

export interface PrintStoreDeps {
  document: DocumentStore;
  ui: UiStore;
  platform: Pick<Platform, 'print'>;
  /** `loadScoreFonts` unless given. */
  fonts?: () => Promise<void>;
  layout?: typeof layoutScore;
  /** Resolves after the next paint; tests pass `Promise.resolve`. */
  nextPaint?: () => Promise<void>;
}

export interface PrintDialogState {
  settings: PrintSettings;
  /** The score's tracks as the dialog lists them: the name, else "Track N". */
  choices: readonly { id: Id; name: string }[];
  error?: string;
}

export interface PrintJob extends PrintContent {
  id: number;
}

export interface PrintState {
  dialog: PrintDialogState | undefined;
  preparing: boolean;
  job: PrintJob | undefined;
  open(): void;
  update(change: Partial<PrintSettings>): void;
  cancel(): void;
  print(): Promise<void>;
  /** The print container's signal that job `id`'s pages are in the DOM. */
  rendered(id: number): void;
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    const later = () => setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(later);
    else later();
  });
}

const PAGE_SIZE = { a4: 'A4', letter: 'Letter' } as const;

/** The print flow: our dialog's choices, the print layout, the mounted pages, the system dialog. */
export function createPrintStore(deps: PrintStoreDeps) {
  const { document, ui, platform, fonts = loadScoreFonts, nextPaint = afterPaint } = deps;
  let jobs = 0;
  let remembered: Omit<PrintSettings, 'tracks'> | undefined;
  let waiting: { id: number; resolve: () => void } | undefined;

  return create<PrintState>()((set, get) => ({
    dialog: undefined,
    preparing: false,
    job: undefined,
    open() {
      const { score, view } = document.getState();
      const state = get();
      if (!score || state.dialog || state.preparing || state.job) return;
      const visible = visibleTrackIds(view, score);
      const wanted = visible === 'all' ? undefined : new Set(visible);
      set({
        dialog: {
          settings: {
            tracks: score.tracks.map(({ id }) => id).filter((id) => wanted?.has(id) ?? true),
            ...(remembered ?? { paper: ui.getState().view.paper, header: true, pageNumbers: true }),
          },
          choices: score.tracks.map(({ id, name }, i) => ({
            id,
            name: name.trim() || `Track ${String(i + 1)}`,
          })),
        },
      });
    },
    update(change) {
      const { dialog, preparing } = get();
      if (!dialog || preparing) return;
      set({ dialog: { settings: { ...dialog.settings, ...change }, choices: dialog.choices } });
    },
    cancel() {
      if (!get().preparing) set({ dialog: undefined });
    },
    async print() {
      const { dialog, preparing } = get();
      const { score } = document.getState();
      if (!score || !dialog || preparing) return;
      const present = new Set(score.tracks.map(({ id }) => id));
      if (!dialog.settings.tracks.some((id) => present.has(id))) return;
      set({ preparing: true });
      try {
        // "Preparing…" paints before the layout blocks the thread.
        await nextPaint();
        await fonts();
        let content: PrintContent;
        try {
          const { view, file } = document.getState();
          content = layoutForPrint(score, dialog.settings, view.notation, file?.name, deps.layout);
        } catch (error) {
          console.error(error);
          set({
            preparing: false,
            dialog: { ...dialog, error: error instanceof Error ? error.message : String(error) },
          });
          return;
        }
        const { paper, header, pageNumbers } = dialog.settings;
        remembered = { paper, header, pageNumbers };
        jobs += 1;
        const id = jobs;
        const mounted = new Promise<void>((resolve) => {
          waiting = { id, resolve };
        });
        set({ dialog: undefined, job: { id, ...content } });
        await mounted;
        await platform.print({ pageSize: PAGE_SIZE[content.settings.paper] });
      } finally {
        waiting = undefined;
        set({ job: undefined, preparing: false });
      }
    },
    rendered(id) {
      if (waiting?.id !== id) return;
      const { resolve } = waiting;
      waiting = undefined;
      resolve();
    },
  }));
}

export type PrintStore = ReturnType<typeof createPrintStore>;
